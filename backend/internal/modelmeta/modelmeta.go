package modelmeta

// ModelInfo 定义平台支持的模型元数据。
// Capabilities 表示模型能执行的功能（chat/image/search/reasoning/video 等）。
// SupportedInputs 表示模型原生支持的输入类型（text/image/pdf/word/excel/ppt/csv/txt/code/video/audio 等）。
type ModelInfo struct {
	ID                      string   `json:"id"`
	Name                    string   `json:"name"`
	Provider                string   `json:"provider"`
	Description             string   `json:"description"`
	Color                   string   `json:"color"`
	Capabilities            []string `json:"capabilities"`     // 功能：chat | image | search | reasoning | video
	SupportedInputs         []string `json:"supported_inputs"` // 输入：text | image | pdf | word | excel | ppt | csv | txt | code | video | audio
	SupportedFileExtensions []string `json:"supported_file_extensions,omitempty"`
	SupportedFileMimeTypes  []string `json:"supported_file_mime_types,omitempty"`
	FileAccept              string   `json:"file_accept,omitempty"`
	Available               bool     `json:"available"`
	ReasoningLevel          string   `json:"reasoning_level,omitempty"`      // 对外三档：fast / thinking / expert
	ReasoningLevelName      string   `json:"reasoning_level_name,omitempty"` // 快速 / 思考 / 专家
	ReasoningEffort         string   `json:"reasoning_effort,omitempty"`     // 当前默认档位映射后的 provider effort/budget
	ReasoningParameter      string   `json:"reasoning_parameter,omitempty"`  // provider 实际字段说明：OpenAI reasoning.effort / Gemini thinking_level / Gemini 2.5 thinking_budget
	ReasoningFastValue      string   `json:"reasoning_fast_value,omitempty"`
	ReasoningThinkingValue  string   `json:"reasoning_thinking_value,omitempty"`
	ReasoningExpertValue    string   `json:"reasoning_expert_value,omitempty"`
	Status                  string   `json:"status,omitempty"`
	StatusMessage           string   `json:"status_message,omitempty"`
}

var SupportedModels = []ModelInfo{
	// OpenAI
	{ID: "gpt-5.4", Name: "GPT 5.4", Provider: "OpenAI", Description: "Flagship general-purpose model with strong overall capability", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gpt-5.4-mini", Name: "GPT 5.4 Mini", Provider: "OpenAI", Description: "Fast and cost-effective for everyday tasks", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gpt-5.5", Name: "GPT 5.5", Provider: "OpenAI", Description: "Enhanced fifth-generation model with stronger reasoning", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gpt-5.5-pro", Name: "GPT 5.5 Pro", Provider: "OpenAI", Description: "Flagship professional model with top multimodal capability", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gpt-image-2", Name: "GPT Image 2", Provider: "OpenAI", Description: "Native multimodal model for image generation", Color: "#10a37f", Capabilities: []string{"image"}, SupportedInputs: []string{"text"}},
	// DeepSeek
	{ID: "deepseek-v4-pro", Name: "DeepSeek-V4 Pro", Provider: "DeepSeek", Description: "Enhanced V4 Pro with the strongest reasoning capability", Color: "#4d6bfa", Capabilities: []string{"chat", "reasoning"}, SupportedInputs: []string{"text"}},
	{ID: "deepseek-v4-flash", Name: "DeepSeek-V4 Flash", Provider: "DeepSeek", Description: "Lightweight V4 with ultra-fast responses", Color: "#6366f1", Capabilities: []string{"chat", "reasoning"}, SupportedInputs: []string{"text"}},
	// Google
	{ID: "gemini-2.5-pro", Name: "Gemini 2.5 Pro", Provider: "Google", Description: "Long-context multimodal document understanding model for document research workflows", Color: "#4285f4", Capabilities: []string{"chat", "document", "reasoning", "search"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro", Provider: "Google", Description: "Next-generation flagship reasoning model with stronger multimodal capability", Color: "#4285f4", Capabilities: []string{"chat", "reasoning", "search"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gemini-3.5-flash", Name: "Gemini 3.5 Flash", Provider: "Google", Description: "Next-generation high-speed model with faster, steadier responses", Color: "#4285f4", Capabilities: []string{"chat", "reasoning", "search"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "gemini-3.1-flash-lite", Name: "Gemini 3.1 Flash", Provider: "Google", Description: "Next-generation fast model, ideal for everyday Q&A", Color: "#4285f4", Capabilities: []string{"chat", "reasoning", "search"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	// Volcengine Video
	{ID: "doubao-seedance-2.0-mini", Name: "Seedance 2.0 Mini", Provider: "Volcengine", Description: "Seedance 2.0 mini video generation model from Volcengine", Color: "#ff6a00", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image", "video"}},
	{ID: "doubao-seedance-1.5-pro", Name: "Seedance 1.5 Pro", Provider: "Volcengine", Description: "Seedance 1.5 Pro video generation model from Volcengine", Color: "#ff0050", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image", "video"}},
	{ID: "doubao-seedance-1.0-pro", Name: "Seedance 1.0 Pro", Provider: "Volcengine", Description: "Seedance 1.0 Pro video generation model from Volcengine", Color: "#fb7185", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image"}},
	{ID: "doubao-seedance-1.0-pro-fast", Name: "Seedance 1.0 Pro Fast", Provider: "Volcengine", Description: "Seedance 1.0 Pro Fast video generation model from Volcengine", Color: "#f97316", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image"}},
	{ID: "doubao-seedance-2-0-fast-260128", Name: "Seedance 2.0 Fast (Legacy)", Provider: "Volcengine", Description: "Legacy fast video generation model from Volcengine", Color: "#ff6a00", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image", "video"}},
	{ID: "doubao-seedance-2-0-260128", Name: "Seedance 2.0 (Legacy)", Provider: "Volcengine", Description: "Legacy standard video generation model from Volcengine", Color: "#ff0050", Capabilities: []string{"video"}, SupportedInputs: []string{"text", "image", "video"}},
	// Moonshot
	{ID: "kimi-k2.5", Name: "Kimi K2.5", Provider: "Moonshot", Description: "Flagship multimodal model with image understanding and 256K context", Color: "#00b96b", Capabilities: []string{"chat"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "kimi-k2.6", Name: "Kimi K2.6", Provider: "Moonshot", Description: "Latest flagship with stronger multimodal and reasoning capability", Color: "#00b96b", Capabilities: []string{"chat"}, SupportedInputs: []string{"text", "image", "pdf", "word", "excel", "ppt", "csv", "txt", "code"}},
	{ID: "kimi-k2.7-code", Name: "Kimi K2.7 Code", Provider: "Moonshot", Description: "Advanced coding model for software development and code reasoning", Color: "#00b96b", Capabilities: []string{"chat"}, SupportedInputs: []string{"text", "code", "pdf", "word", "excel", "ppt", "csv", "txt"}},
}

// AllModels 返回所有模型，并补齐前端展示所需的默认状态与文件能力字段。
func AllModels() []ModelInfo {
	var result []ModelInfo
	for _, m := range SupportedModels {
		result = append(result, WithFileSupport(m))
	}
	return result
}

// ChatModels 返回支持对话的模型
func ChatModels() []ModelInfo {
	return ModelsByCapability("chat")
}

// ImageModels 返回支持画图的模型
func ImageModels() []ModelInfo {
	return ModelsByCapability("image")
}

// VideoModels 返回支持视频生成的模型
func VideoModels() []ModelInfo {
	return ModelsByCapability("video")
}

// ModelsByCapability 返回支持指定能力的模型
func ModelsByCapability(capability string) []ModelInfo {
	var result []ModelInfo
	for _, m := range SupportedModels {
		if ModelHasCapability(m, capability) {
			result = append(result, WithFileSupport(m))
		}
	}
	return result
}

func WithFileSupport(model ModelInfo) ModelInfo {
	if model.Status == "" {
		model.Status = "available"
	}
	if !model.Available && model.Status == "available" {
		model.Available = true
	}
	model.SupportedFileExtensions = FileExtensionsForInputs(model.SupportedInputs)
	model.SupportedFileMimeTypes = FileMimeTypesForInputs(model.SupportedInputs)
	model.FileAccept = FileAcceptForInputs(model.SupportedInputs)
	return model
}

func ModelHasCapability(model ModelInfo, capability string) bool {
	for _, c := range model.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

func FindModelInfo(modelID string) (ModelInfo, bool) {
	for _, m := range SupportedModels {
		if m.ID == modelID {
			return m, true
		}
	}
	return ModelInfo{}, false
}

func SupportsModelCapability(modelID string, capability string) bool {
	model, ok := FindModelInfo(modelID)
	if !ok {
		return false
	}
	return ModelHasCapability(model, capability)
}

func SupportsSearch(modelID string) bool {
	return SupportsModelCapability(modelID, "search")
}

// SupportsInput 判断指定模型是否支持某种输入类型
func SupportsInput(modelID string, inputType string) bool {
	model, ok := FindModelInfo(modelID)
	if !ok {
		return false
	}
	for _, i := range model.SupportedInputs {
		if i == inputType {
			return true
		}
	}
	return false
}
