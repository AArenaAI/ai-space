package services

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"aipool-backend/internal/models"
	"aipool-backend/internal/services/embedding"
	"gorm.io/gorm"
)

// ChunkSearchResult 检索结果
type ChunkSearchResult struct {
	Chunk     models.FileChunk
	Score     float64
	Relevance string // high | medium | low
}

// RetrievalService 文件检索服务
type RetrievalService struct {
	db       *gorm.DB
	embedder embedding.Provider
}

// NewRetrievalService 创建检索服务
func NewRetrievalService(db *gorm.DB, embedder embedding.Provider) *RetrievalService {
	return &RetrievalService{
		db:       db,
		embedder: embedder,
	}
}

// Search 检索相关 chunks
// fileIDs: 文件的自增 ID 列表
// query: 用户查询
// topK: 最多返回多少个 chunks
// forceKeyword: 强制使用关键词检索（对比模式统一检索用）
func (s *RetrievalService) Search(fileIDs []uint, query string, topK int, forceKeyword bool) ([]ChunkSearchResult, error) {
	if len(fileIDs) == 0 || strings.TrimSpace(query) == "" {
		return nil, nil
	}

	if topK <= 0 {
		topK = 8
	}

	// 检查是否有可用的 embedding
	hasEmbedding := !forceKeyword && s.hasEmbeddings(fileIDs)

	if hasEmbedding {
		results, err := s.vectorSearch(fileIDs, query, topK)
		if err == nil && len(results) > 0 {
			return results, nil
		}
		// 向量检索失败时降级到关键词
	}

	return s.keywordSearch(fileIDs, query, topK)
}

// hasEmbeddings 检查文件是否已有 embedding
func (s *RetrievalService) hasEmbeddings(fileIDs []uint) bool {
	if s.embedder == nil {
		return false
	}
	var count int64
	s.db.Model(&models.File{}).
		Where("id IN ?", fileIDs).
		Where("embedding_status = ?", "done").
		Count(&count)
	return count > 0
}

// vectorSearch 向量检索
func (s *RetrievalService) vectorSearch(fileIDs []uint, query string, topK int) ([]ChunkSearchResult, error) {
	ctx := context.Background()

	// 1. 计算查询向量
	queryVec, _, err := s.embedder.EmbedQuery(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("查询 embedding 失败: %w", err)
	}

	// 2. 加载候选 embeddings
	info := s.embedder.ModelInfo()
	var embeddings []models.FileEmbedding
	if err := s.db.Where("file_id IN ?", fileIDs).
		Where("provider = ? AND model = ? AND dimension = ?", info.Provider, info.Model, info.Dimension).
		Find(&embeddings).Error; err != nil {
		return nil, fmt.Errorf("加载 embeddings 失败: %w", err)
	}

	if len(embeddings) == 0 {
		return nil, fmt.Errorf("没有找到 embeddings")
	}

	// 3. 计算相似度并排序
	type scoredEmbedding struct {
		embedding models.FileEmbedding
		score     float64
	}
	var scored []scoredEmbedding

	for _, emb := range embeddings {
		vec, err := embedding.DecodeVector(emb.Vector)
		if err != nil {
			continue
		}
		score := cosineSimilarity(queryVec, vec)
		scored = append(scored, scoredEmbedding{embedding: emb, score: score})
	}

	// 按相似度降序排序
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	// 4. 加载对应的 chunks
	var results []ChunkSearchResult
	for i := 0; i < len(scored) && i < topK; i++ {
		var chunk models.FileChunk
		if err := s.db.First(&chunk, scored[i].embedding.ChunkID).Error; err != nil {
			continue
		}
		results = append(results, ChunkSearchResult{
			Chunk:     chunk,
			Score:     scored[i].score,
			Relevance: relevanceLabel(scored[i].score),
		})
	}

	return results, nil
}

// keywordSearch 关键词检索
func (s *RetrievalService) keywordSearch(fileIDs []uint, query string, topK int) ([]ChunkSearchResult, error) {
	keywords := extractKeywords(query)

	var chunks []models.FileChunk
	if err := s.db.Where("file_id IN ?", fileIDs).
		Order("chunk_index").
		Find(&chunks).Error; err != nil {
		return nil, err
	}

	// 计算每个 chunk 的匹配分数
	type scoredChunk struct {
		chunk models.FileChunk
		score float64
	}
	var scored []scoredChunk

	for _, chunk := range chunks {
		score := keywordScore(chunk.Content, keywords)
		if score > 0 {
			scored = append(scored, scoredChunk{chunk: chunk, score: score})
		}
	}

	// 如果没有匹配到，返回所有 chunks（限制数量）
	if len(scored) == 0 {
		for i, chunk := range chunks {
			if i >= topK {
				break
			}
			scored = append(scored, scoredChunk{chunk: chunk, score: 0})
		}
	}

	// 按分数降序排序
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	var results []ChunkSearchResult
	for i := 0; i < len(scored) && i < topK; i++ {
		results = append(results, ChunkSearchResult{
			Chunk:     scored[i].chunk,
			Score:     scored[i].score,
			Relevance: relevanceLabel(scored[i].score),
		})
	}

	return results, nil
}

// keywordScore 计算关键词匹配分数
func keywordScore(text string, keywords []string) float64 {
	text = strings.ToLower(text)
	if len(keywords) == 0 {
		return 0
	}
	matches := 0
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			matches++
		}
	}
	return float64(matches) / float64(len(keywords))
}

// cosineSimilarity 计算余弦相似度
// OpenAI embeddings 已归一化，可用 dot product 替代
func cosineSimilarity(a, b embedding.EmbeddingVector) float64 {
	if len(a) != len(b) {
		return 0
	}
	if len(a) == 0 {
		return 0
	}
	var dot float64
	var normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// relevanceLabel 根据分数返回相关性标签
func relevanceLabel(score float64) string {
	if score >= 0.8 {
		return "high"
	} else if score >= 0.6 {
		return "medium"
	}
	return "low"
}

// DynamicTopK 根据模型上下文大小动态调整 TopK
// 简化版：根据 model 名称推断
func DynamicTopK(model string) int {
	switch {
	case strings.Contains(model, "flash") || strings.Contains(model, "mini"):
		return 4
	case strings.Contains(model, "opus") || strings.Contains(model, "o1") || strings.Contains(model, "o3"):
		return 12
	default:
		return 8
	}
}
