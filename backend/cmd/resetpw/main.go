package main

import (
	"fmt"
	"log"
	"os"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	if len(os.Args) < 3 {
		log.Fatal("Usage: resetpw <email> <new-password>\nDatabase connection is read from DATABASE_URL / backend/.env")
	}
	email := os.Args[1]
	password := os.Args[2]

	cfg := config.Load()
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	var user models.User
	if err := db.Where("email = ?", email).First(&user).Error; err != nil {
		log.Fatalf("User not found: %v", err)
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}

	db.Model(&user).Update("password", string(hashed))
	fmt.Printf("✅ Password reset for %s\n", email)
}
