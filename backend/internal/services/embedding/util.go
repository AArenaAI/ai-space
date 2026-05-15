package embedding

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

// EncodeVector 将 float32 向量编码为 BLOB 字节
func EncodeVector(vec EmbeddingVector) []byte {
	if len(vec) == 0 {
		return nil
	}
	buf := new(bytes.Buffer)
	for _, v := range vec {
		_ = binary.Write(buf, binary.LittleEndian, v)
	}
	return buf.Bytes()
}

// DecodeVector 将 BLOB 字节解码为 float32 向量
func DecodeVector(data []byte) (EmbeddingVector, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("无效的 BLOB 长度: %d，必须是 4 的倍数", len(data))
	}
	count := len(data) / 4
	vec := make(EmbeddingVector, count)
	buf := bytes.NewReader(data)
	for i := range vec {
		if err := binary.Read(buf, binary.LittleEndian, &vec[i]); err != nil {
			return nil, fmt.Errorf("解码向量失败: %w", err)
		}
	}
	return vec, nil
}

// EncodeVectors 将多个向量编码为单个 BLOB
// 格式: [4 bytes count][4 bytes dim][data...]
func EncodeVectors(vecs []EmbeddingVector) []byte {
	if len(vecs) == 0 {
		return nil
	}
	buf := new(bytes.Buffer)
	// 写入向量数
	_ = binary.Write(buf, binary.LittleEndian, int32(len(vecs)))
	// 写入维度
	_ = binary.Write(buf, binary.LittleEndian, int32(len(vecs[0])))
	// 写入数据
	for _, vec := range vecs {
		for _, v := range vec {
			_ = binary.Write(buf, binary.LittleEndian, v)
		}
	}
	return buf.Bytes()
}

// DecodeVectors 将单个 BLOB 解码为多个向量
func DecodeVectors(data []byte) ([]EmbeddingVector, error) {
	if len(data) < 8 {
		return nil, nil
	}
	buf := bytes.NewReader(data)
	var count, dim int32
	if err := binary.Read(buf, binary.LittleEndian, &count); err != nil {
		return nil, fmt.Errorf("解码向量数失败: %w", err)
	}
	if err := binary.Read(buf, binary.LittleEndian, &dim); err != nil {
		return nil, fmt.Errorf("解码维度失败: %w", err)
	}
	expectedLen := int(count) * int(dim) * 4
	if len(data)-8 != expectedLen {
		return nil, fmt.Errorf("BLOB 长度不匹配: 预期 %d, 实际 %d", expectedLen, len(data)-8)
	}
	vecs := make([]EmbeddingVector, count)
	for i := range vecs {
		vecs[i] = make(EmbeddingVector, dim)
		for j := range vecs[i] {
			if err := binary.Read(buf, binary.LittleEndian, &vecs[i][j]); err != nil {
				return nil, fmt.Errorf("解码向量失败: %w", err)
			}
		}
	}
	return vecs, nil
}
