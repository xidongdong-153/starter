import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { IncomingHttpHeaders } from "node:http";

export interface AiUrlGuardOptions {
  appEnv?: "development" | "test" | "production";
  allowedPrivateCidrs?: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class AiUrlGuardError extends Error {
  constructor(
    readonly reason:
      "scheme" | "host" | "private" | "redirect" | "timeout" | "response_size",
  ) {
    super(`AI outbound request rejected: ${reason}`);
    this.name = "AiUrlGuardError";
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);
const METADATA_ADDRESSES = new Set(["169.254.169.254", "100.100.100.200"]);

export function createAiUrlGuard(options: AiUrlGuardOptions = {}) {
  const appEnv = options.appEnv ?? "development";
  const allowedPrivateCidrs = (options.allowedPrivateCidrs ?? []).map(
    parseCidr,
  );
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  async function resolveAllowedAddress(input: string | URL): Promise<{
    url: URL;
    address: string;
  }> {
    const url = input instanceof URL ? new URL(input) : new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new AiUrlGuardError("scheme");
    if (url.username || url.password || url.search || url.hash)
      throw new AiUrlGuardError("host");

    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (METADATA_HOSTS.has(hostname)) throw new AiUrlGuardError("private");
    const addresses = net.isIP(hostname)
      ? [hostname]
      : (await dns.lookup(hostname, { all: true })).map((item) => item.address);
    const address = addresses.find(
      (item) =>
        isAllowedAddress(item, allowedPrivateCidrs) ||
        (appEnv !== "production" && isLoopbackAddress(item)),
    );
    if (!address) throw new AiUrlGuardError("private");
    if (
      appEnv === "production" &&
      url.protocol !== "https:" &&
      isPublicAddress(address)
    ) {
      throw new AiUrlGuardError("scheme");
    }
    return { url, address };
  }

  async function assertAllowed(input: string | URL): Promise<URL> {
    return (await resolveAllowedAddress(input)).url;
  }

  async function fetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = input instanceof Request ? input : undefined;
    const source: string | URL = request
      ? request.url
      : (input as string | URL);
    const { url, address } = await resolveAllowedAddress(source);
    const callerSignal = init?.signal ?? request?.signal;
    const signal = callerSignal ?? new AbortController().signal;
    const headers = new Headers(init?.headers ?? request?.headers);
    const method = init?.method ?? request?.method ?? "GET";
    const body =
      init?.body ?? (request ? await request.arrayBuffer() : undefined);
    const controller = new AbortController();
    const combinedSignal = AbortSignal.any([signal, controller.signal]);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let bodyOwnsTimeout = false;

    try {
      const response = await requestWithPinnedAddress({
        url,
        address,
        method,
        headers,
        body,
        signal: combinedSignal,
      });
      if (response.status >= 300 && response.status < 400)
        throw new AiUrlGuardError("redirect");
      const length = response.headers.get("content-length");
      if (length && Number(length) > maxResponseBytes)
        throw new AiUrlGuardError("response_size");
      if (!response.body) return response;
      bodyOwnsTimeout = true;
      return limitResponseBody(
        response,
        maxResponseBytes,
        timeout,
        controller,
        signal,
      );
    } catch (error) {
      if (controller.signal.aborted && !signal.aborted)
        throw new AiUrlGuardError("timeout");
      throw error;
    } finally {
      if (!bodyOwnsTimeout) clearTimeout(timeout);
    }
  }

  return { assertAllowed, fetch };

  function limitResponseBody(
    response: Response,
    limit: number,
    timeout: ReturnType<typeof setTimeout>,
    controller: AbortController,
    callerSignal: AbortSignal,
  ): Response {
    const reader = response.body!.getReader();
    let received = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const next = await reader.read();
          if (next.done) {
            clearTimeout(timeout);
            streamController.close();
            return;
          }
          received += next.value.byteLength;
          if (received > limit) {
            clearTimeout(timeout);
            await reader.cancel();
            streamController.error(new AiUrlGuardError("response_size"));
            return;
          }
          streamController.enqueue(next.value);
        } catch (error) {
          clearTimeout(timeout);
          streamController.error(
            controller.signal.aborted && !callerSignal.aborted
              ? new AiUrlGuardError("timeout")
              : error,
          );
        }
      },
      async cancel(reason) {
        clearTimeout(timeout);
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}

type AiRequestBody = NonNullable<RequestInit["body"]> | ArrayBuffer;

async function requestWithPinnedAddress(input: {
  url: URL;
  address: string;
  method: string;
  headers: Headers;
  body: AiRequestBody | undefined;
  signal: AbortSignal;
}): Promise<Response> {
  const transport = input.url.protocol === "https:" ? https : http;
  const body =
    input.body === undefined ? undefined : await bodyBytes(input.body);
  const requestHeaders = Object.fromEntries(input.headers.entries());
  if (body && !input.headers.has("content-length"))
    requestHeaders["content-length"] = String(body.byteLength);

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port || undefined,
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: requestHeaders,
        // The lookup result is passed to the socket connection. This prevents
        // the second DNS lookup that would otherwise reopen the SSRF window.
        // Node 的 autoSelectFamily 默认开启，会用 all: true 调用 lookup，
        // 这时必须回传数组，否则连接阶段直接抛 ERR_INVALID_IP_ADDRESS。
        lookup(_hostname, options, callback) {
          const family = net.isIP(input.address);
          if (options.all) {
            callback(null, [{ address: input.address, family }]);
            return;
          }
          callback(null, input.address, family);
        },
        signal: input.signal,
      },
      (response) => {
        const headers = headersFromNode(response.headers);
        const bodyStream = ReadableStream.from(
          response as unknown as AsyncIterable<Uint8Array>,
        );
        resolve(
          new Response(bodyStream, {
            status: response.statusCode ?? 502,
            statusText: response.statusMessage,
            headers,
          }),
        );
      },
    );
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function bodyBytes(body: AiRequestBody): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function headersFromNode(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) result.set(name, value.join(", "));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

type Cidr = { network: bigint; mask: bigint; bits: number };

function parseCidr(value: string): Cidr {
  const [host, prefixText] = value.split("/");
  if (!host) throw new Error("Invalid AI private CIDR allowlist");
  const bits = net.isIP(host) === 6 ? 128 : 32;
  const prefix = Number(prefixText ?? bits);
  if (
    !net.isIP(host) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > bits
  ) {
    throw new Error("Invalid AI private CIDR allowlist");
  }
  const address = ipToBigInt(host);
  const mask =
    prefix === 0
      ? 0n
      : ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return { network: address & mask, mask, bits };
}

function isLoopbackAddress(address: string): boolean {
  if (net.isIP(address) === 4)
    return inCidr(ipToBigInt(address), ipToBigInt("127.0.0.0"), 8, 32);
  return inCidr(ipToBigInt(address), ipToBigInt("::1"), 128, 128);
}

function isAllowedAddress(address: string, allowed: readonly Cidr[]): boolean {
  if (isForbiddenAddress(address)) return false;
  if (isPublicAddress(address)) return true;
  const value = ipToBigInt(address);
  return allowed.some(
    (item) =>
      item.bits === (net.isIP(address) === 6 ? 128 : 32) &&
      (value & item.mask) === item.network,
  );
}

function isForbiddenAddress(address: string): boolean {
  if (METADATA_ADDRESSES.has(address)) return true;
  const value = ipToBigInt(address);
  const ranges: readonly (readonly [string, number, number])[] =
    net.isIP(address) === 4
      ? [
          ["0.0.0.0", 8, 32],
          ["127.0.0.0", 8, 32],
          ["169.254.0.0", 16, 32],
          ["224.0.0.0", 3, 32],
        ]
      : [
          ["::", 128, 128],
          ["::1", 128, 128],
          ["::ffff:0:0", 96, 128],
          ["fe80::", 10, 128],
          ["ff00::", 8, 128],
        ];
  return ranges.some(([network, prefix, bits]) =>
    inCidr(value, ipToBigInt(network), prefix, bits),
  );
}

function isPublicAddress(address: string): boolean {
  const value = ipToBigInt(address);
  if (net.isIP(address) === 4) {
    const privateRanges: readonly (readonly [string, number])[] = [
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["224.0.0.0", 4],
    ];
    return !privateRanges.some(([network, prefix]) =>
      inCidr(value, ipToBigInt(network), prefix, 32),
    );
  }
  const privateRanges: readonly (readonly [string, number])[] = [
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["::ffff:0:0", 96],
  ];
  return !privateRanges.some(([network, prefix]) =>
    inCidr(value, ipToBigInt(network), prefix, 128),
  );
}

function inCidr(
  value: bigint,
  network: bigint,
  prefix: number,
  bits: number,
): boolean {
  const mask =
    prefix === 0
      ? 0n
      : ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return (value & mask) === (network & mask);
}

function ipToBigInt(address: string): bigint {
  if (net.isIP(address) === 4) {
    return address
      .split(".")
      .reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
  }
  const normalized = address.includes("::")
    ? expandIpv6(address)
    : address.split(":");
  return normalized.reduce(
    (result, part) =>
      (result << 16n) | BigInt(Number.parseInt(part || "0", 16)),
    0n,
  );
}

function expandIpv6(address: string): string[] {
  const [left, right] = address.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const zeros: string[] = [];
  for (
    let index = zeros.length;
    index < 8 - leftParts.length - rightParts.length;
    index += 1
  )
    zeros.push("0");
  return [...leftParts, ...zeros, ...rightParts];
}
