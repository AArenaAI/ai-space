package main

import (
	"fmt"
	"log"
	"os"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	email := "test_final@test.com"
	password := "test123456"
	if len(os.Args) >= 2 {
		email = os.Args[1]
	}
	if len(os.Args) >= 3 {
		password = os.Args[2]
	}

	cfg := config.Load()
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	var u models.User
	if err := db.Where("email = ?", email).First(&u).Error; err != nil {
		log.Fatalf("User not found: %v", err)
	}
	fmt.Println("Email:", u.Email)
	if len(u.Password) > 20 {
		fmt.Println("Password:", u.Password[:20]+"...")
	} else {
		fmt.Println("Password:", u.Password)
	}
	ok := u.CheckPassword(password)
	fmt.Printf("Check %q: %v\n", password, ok)
}
