package main

import (
	"fmt"
	"aipool-backend/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	db, _ := gorm.Open(sqlite.Open("/workspace/data/aipool.db"), &gorm.Config{})
	var u models.User
	db.Where("email=?", "test_final@test.com").First(&u)
	fmt.Println("Email:", u.Email)
	fmt.Println("Password:", u.Password[:20]+"...")
	ok := u.CheckPassword("test123456")
	fmt.Println("Check 'test123456':", ok)
}
