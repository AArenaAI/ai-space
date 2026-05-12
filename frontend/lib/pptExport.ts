// 客户端导出PPT功能 - 动态加载库以避免服务端渲染问题

export interface Slide {
  title: string;
  content: string[];
  subtitle?: string;
}

export interface TemplateStyle {
  bg: string;
  title: string;
  text: string;
  accent: string;
}

export async function exportPPT(
  slides: Slide[],
  style: TemplateStyle,
  filename: string,
  topic: string
): Promise<void> {
  // 动态导入 pptxgenjs（仅在浏览器执行）
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();

  pptx.author = "AI Space";
  pptx.company = "AI Space";
  pptx.subject = topic;
  pptx.title = topic;

  slides.forEach((slide, index) => {
    const pptSlide = pptx.addSlide();
    pptSlide.background = { color: style.bg };

    if (index === 0) {
      pptSlide.addText(slide.title, {
        x: 0.5,
        y: 2,
        w: "90%",
        h: 1,
        fontSize: 44,
        bold: true,
        color: style.title,
        align: "center",
      });
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, {
          x: 0.5,
          y: 3.5,
          w: "90%",
          h: 0.5,
          fontSize: 24,
          color: style.text,
          align: "center",
        });
      }
    } else if (index === slides.length - 1) {
      pptSlide.addText(slide.title, {
        x: 0.5,
        y: 2.5,
        w: "90%",
        h: 1,
        fontSize: 40,
        bold: true,
        color: style.title,
        align: "center",
      });
    } else {
      pptSlide.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: "90%",
        h: 0.8,
        fontSize: 32,
        bold: true,
        color: style.title,
      });

      if (slide.content && slide.content.length > 0) {
        const contentText = slide.content.map((item) => `• ${item}`).join("\n");
        pptSlide.addText(contentText, {
          x: 0.5,
          y: 1.5,
          w: "90%",
          h: 4,
          fontSize: 18,
          color: style.text,
          bullet: { type: "number" },
          lineSpacing: 30,
        });
      }
    }
  });

  pptx.writeFile({ fileName: `${filename}.pptx` });
}
