# Boundaries Reference

## Allowed

- Windows desktop input dispatch into a visible locally logged-in ChatGPT window
- Official visible-UI login recovery through an existing session, password-manager/autofill, or authorized paired device
- Local prompt submission with receipt JSON output
- Retained experimental browser transport for compatibility features
- New chat / project / attachment flows only when explicitly routed through the browser transport

## Forbidden

- Response scraping
- Transcript capture
- Hidden API calls
- Authentication bypass or account recovery outside the requested scope
- Cookie, token, or account data extraction
