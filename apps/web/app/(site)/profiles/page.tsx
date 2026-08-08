import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: '公开资料',
  description: '通过用户 ID 查看 Starter 的公开资料。',
}

export default async function ProfilesIndexPage({ searchParams }: { searchParams: Promise<{ userId?: string }> }) {
  const { userId } = await searchParams
  const trimmedUserId = userId?.trim()
  if (trimmedUserId) redirect(`/profiles/${encodeURIComponent(trimmedUserId)}`)

  return (
    <main className="page-enter site-container py-16 md:py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">PUBLIC PROFILE</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">查看公开资料</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          公开资料页不要求登录。输入资料链接中的用户 ID，打开 API 返回的真实资料。
        </p>
        <form action="/profiles" className="mt-10 flex flex-col gap-3 sm:flex-row" method="get">
          <label className="sr-only" htmlFor="profile-user-id">
            用户 ID
          </label>
          <input
            className="min-h-12 min-w-0 flex-1 rounded-sm border border-border bg-surface px-4 outline-none transition-colors placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-ring"
            id="profile-user-id"
            name="userId"
            placeholder="输入用户 ID"
            required
          />
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-sm bg-primary px-5 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            type="submit"
          >
            打开资料
          </button>
        </form>
      </div>
    </main>
  )
}
