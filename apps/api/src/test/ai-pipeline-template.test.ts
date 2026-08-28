import { describe, expect, it } from "vitest";

import {
  renderTemplate,
  validateStepTemplates,
} from "@api/modules/ai/pipeline/template.js";

const step = (inputTemplate: string) => ({ inputTemplate });

describe("validateStepTemplates 静态校验", () => {
  it("合法引用通过：步骤只能引用更早步骤与 input", () => {
    expect(
      validateStepTemplates([
        step("提取要点：{{input}}"),
        step("翻译：{{steps.0.output}}，原文 {{input}}"),
        step("摘要：{{steps.0.output}} 然后 {{steps.1.output}}"),
      ]),
    ).toBeNull();
  });

  it("越界引用被拒：步骤 0 引用 {{steps.5.output}}", () => {
    const issue = validateStepTemplates([
      step("翻译：{{steps.5.output}}"),
      step("再处理：{{input}}"),
    ]);
    expect(issue).toEqual({
      stepIndex: 0,
      variable: "{{steps.5.output}}",
      allowedMaxIndex: -1,
    });
  });

  it("自引用被拒：步骤 0 引用 {{steps.0.output}}", () => {
    const issue = validateStepTemplates([step("处理：{{steps.0.output}}")]);
    expect(issue).toEqual({
      stepIndex: 0,
      variable: "{{steps.0.output}}",
      allowedMaxIndex: -1,
    });
  });

  it("同序号引用被拒：步骤 1 引用 {{steps.1.output}}，错误信息含序号与变量名", () => {
    const issue = validateStepTemplates([
      step("步骤零：{{input}}"),
      step("步骤一：{{steps.1.output}}"),
    ]);
    expect(issue).toEqual({
      stepIndex: 1,
      variable: "{{steps.1.output}}",
      allowedMaxIndex: 0,
    });
  });

  it("长得像变量的字面量不报错：空格、非数字序号、未知名字", () => {
    expect(
      validateStepTemplates([
        step(
          "{{ foo }} {{steps.x.output}} {{ steps.0.output }} {{output}} {{INPUT}}",
        ),
      ]),
    ).toBeNull();
  });

  it("空步骤列表通过", () => {
    expect(validateStepTemplates([])).toBeNull();
  });
});

describe("renderTemplate 渲染", () => {
  it("替换 input 与 steps.N.output，多次出现都替换", () => {
    expect(
      renderTemplate(
        "{{input}} -> {{steps.0.output}} -> 再引 {{steps.0.output}}",
        {
          input: "原始输入",
          outputs: ["第一步产出"],
        },
      ),
    ).toBe("原始输入 -> 第一步产出 -> 再引 第一步产出");
  });

  it("产出含 {{input}} 字样时不二次展开", () => {
    expect(
      renderTemplate("翻译：{{steps.0.output}}", {
        input: "原始输入",
        outputs: ["模型说要输出 {{input}} 字面量"],
      }),
    ).toBe("翻译：模型说要输出 {{input}} 字面量");
  });

  it("产出含 $ 符号与 $& 时按字面量处理", () => {
    expect(
      renderTemplate("{{steps.0.output}}", {
        input: "",
        outputs: ["价格 $100 与 $& 和 $1"],
      }),
    ).toBe("价格 $100 与 $& 和 $1");
  });

  it("字面量占位符原样保留", () => {
    const template = "{{ foo }} {{steps.x.output}} {{ steps.0.output }}";
    expect(renderTemplate(template, { input: "输入", outputs: ["产出"] })).toBe(
      template,
    );
  });

  it("未定义的 steps.N.output 保留原文（防御路径）", () => {
    expect(
      renderTemplate("{{steps.3.output}}", {
        input: "输入",
        outputs: ["仅一步"],
      }),
    ).toBe("{{steps.3.output}}");
  });

  it("空模板渲染为空字符串", () => {
    expect(renderTemplate("", { input: "输入", outputs: [] })).toBe("");
  });

  it("不含变量的模板原样返回", () => {
    expect(
      renderTemplate("普通文本", { input: "输入", outputs: ["产出"] }),
    ).toBe("普通文本");
  });
});
