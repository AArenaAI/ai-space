import type { LanguageCode } from "@/lib/i18n";
import type { Template } from "@/hooks/useTemplates";

export const LOCALIZED_DEFAULT_TEMPLATE_NAME: Record<LanguageCode, string> = {
  "zh-CN": "默认助手",
  "zh-TW": "預設助手",
  en: "Default Assistant",
  ja: "デフォルトアシスタント",
  ko: "기본 어시스턴트",
  id: "Asisten Default",
  th: "ผู้ช่วยเริ่มต้น",
  vi: "Trợ lý mặc định",
  es: "Asistente predeterminado",
  fr: "Assistant par défaut",
  de: "Standardassistent",
  "pt-BR": "Assistente padrão",
  hi: "डिफ़ॉल्ट सहायक",
  ru: "Помощник по умолчанию",
  tr: "Varsayılan Asistan",
  ms: "Pembantu Lalai",
  fil: "Default Assistant",
};

export const LOCALIZED_DEFAULT_TEMPLATE_PREFIX: Record<LanguageCode, string> = {
  "zh-CN": "你是一个专业的AI助手。请用中文回答用户的问题，确保回复清晰、准确、完整。在适当情况下使用 Markdown 格式（标题、列表、代码块等）来增强可读性。",
  "zh-TW": "你是一個專業的 AI 助手。請用繁體中文回答使用者的問題，確保回覆清晰、準確、完整。在適當情況下使用 Markdown 格式（標題、清單、程式碼區塊等）來增強可讀性。",
  en: "You are a professional AI assistant. Please answer the user's questions in English, ensuring your responses are clear, accurate, and complete. When appropriate, use Markdown formatting (headings, lists, code blocks, etc.) to improve readability.",
  ja: "あなたはプロフェッショナルな AI アシスタントです。ユーザーの質問には日本語で回答し、明確で正確かつ完全な返答を心がけてください。必要に応じて Markdown 形式（見出し、箇条書き、コードブロックなど）を使い、読みやすさを高めてください。",
  ko: "당신은 전문 AI 어시스턴트입니다. 사용자의 질문에 한국어로 답변하고, 답변이 명확하고 정확하며 완전하도록 하세요. 필요한 경우 Markdown 형식(제목, 목록, 코드 블록 등)을 사용해 가독성을 높이세요.",
  id: "Anda adalah asisten AI profesional. Jawablah pertanyaan pengguna dalam bahasa Indonesia, dengan memastikan respons Anda jelas, akurat, dan lengkap. Jika sesuai, gunakan format Markdown (judul, daftar, blok kode, dll.) untuk meningkatkan keterbacaan.",
  th: "คุณคือผู้ช่วย AI มืออาชีพ โปรดตอบคำถามของผู้ใช้เป็นภาษาไทย โดยให้คำตอบชัดเจน ถูกต้อง และครบถ้วน เมื่อเหมาะสม ให้ใช้รูปแบบ Markdown (หัวข้อ รายการ บล็อกโค้ด ฯลฯ) เพื่อให้อ่านง่ายขึ้น",
  vi: "Bạn là một trợ lý AI chuyên nghiệp. Hãy trả lời câu hỏi của người dùng bằng tiếng Việt, đảm bảo câu trả lời rõ ràng, chính xác và đầy đủ. Khi phù hợp, hãy sử dụng định dạng Markdown (tiêu đề, danh sách, khối mã, v.v.) để tăng khả năng đọc.",
  es: "Eres un asistente de IA profesional. Responde las preguntas del usuario en español, asegurándote de que las respuestas sean claras, precisas y completas. Cuando sea apropiado, usa formato Markdown (títulos, listas, bloques de código, etc.) para mejorar la legibilidad.",
  fr: "Vous êtes un assistant IA professionnel. Répondez aux questions de l’utilisateur en français, en veillant à ce que vos réponses soient claires, exactes et complètes. Lorsque c’est pertinent, utilisez le format Markdown (titres, listes, blocs de code, etc.) pour améliorer la lisibilité.",
  de: "Du bist ein professioneller KI-Assistent. Beantworte die Fragen des Nutzers auf Deutsch und stelle sicher, dass deine Antworten klar, präzise und vollständig sind. Verwende bei Bedarf Markdown-Formatierung (Überschriften, Listen, Codeblöcke usw.), um die Lesbarkeit zu verbessern.",
  "pt-BR": "Você é um assistente de IA profissional. Responda às perguntas do usuário em português do Brasil, garantindo que as respostas sejam claras, precisas e completas. Quando apropriado, use formatação Markdown (títulos, listas, blocos de código etc.) para melhorar a legibilidade.",
  hi: "आप एक पेशेवर AI सहायक हैं। कृपया उपयोगकर्ता के प्रश्नों का उत्तर हिन्दी में दें और सुनिश्चित करें कि उत्तर स्पष्ट, सटीक और पूर्ण हों। जहाँ उपयुक्त हो, पठनीयता बढ़ाने के लिए Markdown प्रारूप (शीर्षक, सूचियाँ, कोड ब्लॉक आदि) का उपयोग करें।",
  ru: "Вы профессиональный AI-ассистент. Отвечайте на вопросы пользователя на русском языке, обеспечивая ясность, точность и полноту ответов. При необходимости используйте формат Markdown (заголовки, списки, блоки кода и т. д.), чтобы повысить читаемость.",
  tr: "Profesyonel bir yapay zekâ asistanısınız. Kullanıcının sorularını Türkçe yanıtlayın; yanıtların açık, doğru ve eksiksiz olmasını sağlayın. Uygun olduğunda okunabilirliği artırmak için Markdown biçimlendirmesi (başlıklar, listeler, kod blokları vb.) kullanın.",
  ms: "Anda ialah pembantu AI profesional. Jawab soalan pengguna dalam bahasa Melayu, pastikan jawapan jelas, tepat dan lengkap. Apabila sesuai, gunakan format Markdown (tajuk, senarai, blok kod dan sebagainya) untuk meningkatkan kebolehbacaan.",
  fil: "Isa kang propesyonal na AI assistant. Sagutin ang mga tanong ng user sa Filipino, at tiyaking malinaw, tumpak, at kumpleto ang mga sagot. Kapag angkop, gumamit ng Markdown formatting (mga heading, listahan, code block, atbp.) para mas madaling basahin.",
};

export function getLocalizedDefaultTemplatePrefix(language: LanguageCode) {
  return LOCALIZED_DEFAULT_TEMPLATE_PREFIX[language] || LOCALIZED_DEFAULT_TEMPLATE_PREFIX.en;
}

export function getLocalizedDefaultTemplateName(language: LanguageCode) {
  return LOCALIZED_DEFAULT_TEMPLATE_NAME[language] || LOCALIZED_DEFAULT_TEMPLATE_NAME.en;
}

export function isSystemDefaultTemplate(template?: Pick<Template, "is_default"> | null) {
  return Boolean(template?.is_default);
}

export function localizeSystemDefaultTemplate<T extends Template>(template: T, language: LanguageCode): T {
  if (!isSystemDefaultTemplate(template)) return template;
  return {
    ...template,
    name: getLocalizedDefaultTemplateName(language),
    prefix: getLocalizedDefaultTemplatePrefix(language),
  };
}
