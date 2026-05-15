package embedding

import (
	"context"
	"math"
)

// EmbeddingVector 向量表示，使用 float32 以匹配 OpenAI embedding 格式
type EmbeddingVector []float32

// ModelInfo embedding 模型信息
type ModelInfo struct {
	Provider  string // openai | gemini | local
	Model     string // text-embedding-3-small
	Dimension int    // 1536
}

// Provider embedding 服务提供者接口
// 支持批量文档 embedding 和单条查询 embedding
type Provider interface {
	// EmbedDocuments 批量将文本列表转为向量
	EmbedDocuments(ctx context.Context, texts []string) ([]EmbeddingVector, error)

	// EmbedQuery 将查询文本转为向量
	EmbedQuery(ctx context.Context, query string) (EmbeddingVector, error)

	// ModelInfo 返回当前 provider 的模型信息
	ModelInfo() ModelInfo
}

// CosineSimilarity 计算两个向量的余弦相似度
// 注意：OpenAI embeddings 已归一化，cosine similarity 等价于 dot product
func CosineSimilarity(a, b EmbeddingVector) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(normA) * math.Sqrt(normB)))
}

// DotProduct 计算两个向量的点积
// 对于已归一化的 OpenAI embeddings，dot product 等价于 cosine similarity
func DotProduct(a, b EmbeddingVector) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
	}
	return float32(dot)
}
