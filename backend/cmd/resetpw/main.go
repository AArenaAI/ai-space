package main

import (
	"fmt"
	"log"
	"os"

	"aipool-backend/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	if len(os.Args) < 4 {
		log.Fatal("Usage: resetpw <dbfile> <email> <new-password>")
	}
	dbfile := os.Args[1]
	email := os.Args[2]
	password := os.Args[3]

	db, err := gorm.Open(sqlite.Open(dbfile), &gorm.Config{})
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
