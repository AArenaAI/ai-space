package modelmeta

import (
	"path/filepath"
	"sort"
	"strings"
)

// FileType 定义可上传给聊天模型的文件类型元数据。
// Extension 必须带点，例如 .docx。
type FileType struct {
	Extension string
	MimeType  string
	InputType string
}

// SupportedFileTypes 对齐 OpenAI file inputs 文档，同时按平台抽象映射到 SupportedInputs。
// https://developers.openai.com/api/docs/guides/file-inputs#full-list-of-accepted-file-types
var SupportedFileTypes = []FileType{
	{Extension: ".pdf", MimeType: "application/pdf", InputType: "pdf"},

	// Images / video reference media
	{Extension: ".jpg", MimeType: "image/jpeg", InputType: "image"},
	{Extension: ".jpeg", MimeType: "image/jpeg", InputType: "image"},
	{Extension: ".png", MimeType: "image/png", InputType: "image"},
	{Extension: ".webp", MimeType: "image/webp", InputType: "image"},
	{Extension: ".gif", MimeType: "image/gif", InputType: "image"},
	{Extension: ".bmp", MimeType: "image/bmp", InputType: "image"},
	{Extension: ".mp4", MimeType: "video/mp4", InputType: "video"},
	{Extension: ".mov", MimeType: "video/quicktime", InputType: "video"},

	// Spreadsheets
	{Extension: ".xla", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xlb", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xlc", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xlm", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xls", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xlsx", MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", InputType: "excel"},
	{Extension: ".xlt", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".xlw", MimeType: "application/vnd.ms-excel", InputType: "excel"},
	{Extension: ".csv", MimeType: "text/csv", InputType: "csv"},
	{Extension: ".tsv", MimeType: "text/tsv", InputType: "csv"},
	{Extension: ".iif", MimeType: "text/x-iif", InputType: "csv"},

	// Rich documents
	{Extension: ".doc", MimeType: "application/msword", InputType: "word"},
	{Extension: ".docx", MimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", InputType: "word"},
	{Extension: ".dot", MimeType: "application/msword", InputType: "word"},
	{Extension: ".odt", MimeType: "application/vnd.oasis.opendocument.text", InputType: "word"},
	{Extension: ".rtf", MimeType: "application/rtf", InputType: "word"},

	// Presentations
	{Extension: ".pot", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},
	{Extension: ".ppa", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},
	{Extension: ".pps", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},
	{Extension: ".ppt", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},
	{Extension: ".pptx", MimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", InputType: "ppt"},
	{Extension: ".pwz", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},
	{Extension: ".wiz", MimeType: "application/vnd.ms-powerpoint", InputType: "ppt"},

	// Text and code
	{Extension: ".asm", MimeType: "text/x-asm", InputType: "code"},
	{Extension: ".bat", MimeType: "text/x-shellscript", InputType: "code"},
	{Extension: ".c", MimeType: "text/x-c", InputType: "code"},
	{Extension: ".cc", MimeType: "text/x-c++", InputType: "code"},
	{Extension: ".conf", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".cpp", MimeType: "text/x-c++", InputType: "code"},
	{Extension: ".css", MimeType: "text/css", InputType: "code"},
	{Extension: ".cxx", MimeType: "text/x-c++", InputType: "code"},
	{Extension: ".def", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".dic", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".eml", MimeType: "message/rfc822", InputType: "txt"},
	{Extension: ".h", MimeType: "text/x-c", InputType: "code"},
	{Extension: ".hh", MimeType: "text/x-c++", InputType: "code"},
	{Extension: ".htm", MimeType: "text/html", InputType: "code"},
	{Extension: ".html", MimeType: "text/html", InputType: "code"},
	{Extension: ".ics", MimeType: "text/calendar", InputType: "txt"},
	{Extension: ".ifb", MimeType: "text/calendar", InputType: "txt"},
	{Extension: ".in", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".js", MimeType: "text/javascript", InputType: "code"},
	{Extension: ".json", MimeType: "application/json", InputType: "code"},
	{Extension: ".ksh", MimeType: "text/x-shellscript", InputType: "code"},
	{Extension: ".list", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".log", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".markdown", MimeType: "text/markdown", InputType: "txt"},
	{Extension: ".md", MimeType: "text/markdown", InputType: "txt"},
	{Extension: ".mht", MimeType: "message/rfc822", InputType: "txt"},
	{Extension: ".mhtml", MimeType: "message/rfc822", InputType: "txt"},
	{Extension: ".mime", MimeType: "message/rfc822", InputType: "txt"},
	{Extension: ".mjs", MimeType: "text/javascript", InputType: "code"},
	{Extension: ".nws", MimeType: "message/rfc822", InputType: "txt"},
	{Extension: ".pl", MimeType: "text/x-perl", InputType: "code"},
	{Extension: ".py", MimeType: "text/x-python", InputType: "code"},
	{Extension: ".rst", MimeType: "text/x-rst", InputType: "txt"},
	{Extension: ".s", MimeType: "text/x-asm", InputType: "code"},
	{Extension: ".sql", MimeType: "application/x-sql", InputType: "code"},
	{Extension: ".srt", MimeType: "text/srt", InputType: "txt"},
	{Extension: ".text", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".txt", MimeType: "text/plain", InputType: "txt"},
	{Extension: ".vcf", MimeType: "text/x-vcard", InputType: "txt"},
	{Extension: ".vtt", MimeType: "text/vtt", InputType: "txt"},
	{Extension: ".xml", MimeType: "text/xml", InputType: "code"},

	// Common code extensions accepted by OpenAI MIME list even when not shown in extension column.
	{Extension: ".ts", MimeType: "text/x-typescript", InputType: "code"},
	{Extension: ".tsx", MimeType: "text/tsx", InputType: "code"},
	{Extension: ".jsx", MimeType: "text/jsx", InputType: "code"},
	{Extension: ".go", MimeType: "text/x-go", InputType: "code"},
	{Extension: ".rs", MimeType: "text/x-rust", InputType: "code"},
	{Extension: ".java", MimeType: "text/x-java", InputType: "code"},
	{Extension: ".php", MimeType: "text/x-php", InputType: "code"},
	{Extension: ".rb", MimeType: "text/x-ruby", InputType: "code"},
	{Extension: ".swift", MimeType: "text/x-swift", InputType: "code"},
	{Extension: ".kt", MimeType: "text/x-kotlin", InputType: "code"},
	{Extension: ".scala", MimeType: "text/x-scala", InputType: "code"},
	{Extension: ".r", MimeType: "text/x-r", InputType: "code"},
	{Extension: ".tex", MimeType: "text/x-tex", InputType: "code"},
	{Extension: ".yaml", MimeType: "application/yaml", InputType: "code"},
	{Extension: ".yml", MimeType: "application/yaml", InputType: "code"},
	{Extension: ".toml", MimeType: "application/toml", InputType: "code"},
	{Extension: ".sh", MimeType: "text/x-sh", InputType: "code"},
	{Extension: ".bash", MimeType: "text/x-bash", InputType: "code"},
}

func FileTypeByExtension(filename string) (FileType, bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, ft := range SupportedFileTypes {
		if ft.Extension == ext {
			return ft, true
		}
	}
	return FileType{}, false
}

func FileInputType(filename string, mimeType string) string {
	if ft, ok := FileTypeByExtension(filename); ok {
		return ft.InputType
	}
	mt := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.Contains(mt, "pdf"):
		return "pdf"
	case strings.Contains(mt, "word") || strings.Contains(mt, "officedocument.wordprocessingml") || strings.Contains(mt, "msword") || strings.Contains(mt, "rtf") || strings.Contains(mt, "opendocument.text"):
		return "word"
	case strings.Contains(mt, "spreadsheet") || strings.Contains(mt, "excel") || strings.Contains(mt, "csv") || strings.Contains(mt, "tsv"):
		return "excel"
	case strings.Contains(mt, "presentation") || strings.Contains(mt, "powerpoint"):
		return "ppt"
	case strings.HasPrefix(mt, "text/") || strings.Contains(mt, "json") || strings.Contains(mt, "xml") || strings.Contains(mt, "javascript") || strings.Contains(mt, "typescript"):
		return "txt"
	default:
		return ""
	}
}

func MimeTypeForFile(filename string) string {
	if ft, ok := FileTypeByExtension(filename); ok {
		return ft.MimeType
	}
	return "application/octet-stream"
}

func FileExtensionsForInputs(inputs []string) []string {
	allowed := inputSet(inputs)
	seen := make(map[string]bool)
	var out []string
	for _, ft := range SupportedFileTypes {
		if !allowed[ft.InputType] || seen[ft.Extension] {
			continue
		}
		seen[ft.Extension] = true
		out = append(out, ft.Extension)
	}
	sort.Strings(out)
	return out
}

func FileMimeTypesForInputs(inputs []string) []string {
	allowed := inputSet(inputs)
	seen := make(map[string]bool)
	var out []string
	for _, ft := range SupportedFileTypes {
		if !allowed[ft.InputType] || seen[ft.MimeType] {
			continue
		}
		seen[ft.MimeType] = true
		out = append(out, ft.MimeType)
	}
	sort.Strings(out)
	return out
}

func FileAcceptForInputs(inputs []string) string {
	parts := append(FileExtensionsForInputs(inputs), FileMimeTypesForInputs(inputs)...)
	return strings.Join(parts, ",")
}

func inputSet(inputs []string) map[string]bool {
	allowed := make(map[string]bool, len(inputs))
	for _, input := range inputs {
		allowed[input] = true
	}
	return allowed
}
