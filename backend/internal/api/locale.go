package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

var countryLanguageMap = map[string]string{
	"CN": "zh-CN",
	"SG": "zh-CN",
	"TW": "zh-TW",
	"HK": "zh-TW",
	"MO": "zh-TW",
	"US": "en",
	"GB": "en",
	"AU": "en",
	"CA": "en",
	"NZ": "en",
	"IE": "en",
	"JP": "ja",
	"KR": "ko",
	"ID": "id",
	"TH": "th",
	"VN": "vi",
	"ES": "es",
	"MX": "es",
	"AR": "es",
	"CO": "es",
	"CL": "es",
	"PE": "es",
	"FR": "fr",
	"DE": "de",
	"BR": "pt-BR",
	"PT": "pt-BR",
	"IN": "hi",
	"RU": "ru",
	"TR": "tr",
	"MY": "ms",
	"PH": "fil",
}

type localeDetectResponse struct {
	Country  string `json:"country,omitempty"`
	Language string `json:"language,omitempty"`
	Source   string `json:"source"`
}

// DetectLocale returns a language recommendation from trusted proxy/CDN geo headers.
// It intentionally does not return the raw client IP to the browser.
func DetectLocale(c *gin.Context) {
	country := detectCountryFromHeaders(c)
	if country == "" {
		c.JSON(http.StatusOK, localeDetectResponse{Source: "unknown"})
		return
	}

	language := countryLanguageMap[country]
	if language == "" {
		c.JSON(http.StatusOK, localeDetectResponse{Country: country, Source: "country"})
		return
	}

	c.JSON(http.StatusOK, localeDetectResponse{
		Country:  country,
		Language: language,
		Source:   "country",
	})
}

func detectCountryFromHeaders(c *gin.Context) string {
	for _, header := range []string{
		"CF-IPCountry",
		"X-Vercel-IP-Country",
		"X-Country-Code",
		"X-Appengine-Country",
	} {
		country := normalizeCountryCode(c.GetHeader(header))
		if country != "" {
			return country
		}
	}
	return ""
}

func normalizeCountryCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "XX" || value == "T1" {
		return ""
	}
	value = strings.ToUpper(value)
	if len(value) != 2 {
		return ""
	}
	for _, ch := range value {
		if ch < 'A' || ch > 'Z' {
			return ""
		}
	}
	return value
}
