package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	emailFlag := flag.String("email", "", "user email to promote to admin")
	flag.Parse()
	email := strings.ToLower(strings.TrimSpace(*emailFlag))
	if email == "" && flag.NArg() > 0 {
		email = strings.ToLower(strings.TrimSpace(flag.Arg(0)))
	}
	if email == "" {
		log.Fatal("Usage: makeadmin --email user@example.com\nDatabase connection is read from DATABASE_URL / backend/.env")
	}

	cfg := config.Load()
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}

	var user models.User
	if err := db.Where("email = ?", email).First(&user).Error; err != nil {
		log.Fatalf("User not found: %v", err)
	}
	if err := db.Model(&user).Update("role", "admin").Error; err != nil {
		log.Fatalf("Promote user failed: %v", err)
	}
	fmt.Printf("✅ %s is now admin\n", email)
}
