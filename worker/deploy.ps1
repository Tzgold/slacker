# Slacker worker deploy helper
# Run from PowerShell:  cd C:\Users\Admin\Documents\slacker\worker
#                       .\deploy.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n=== Slacker Worker Deploy ===`n" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "Checking Cloudflare login..." -ForegroundColor Yellow
$whoami = npx wrangler whoami 2>&1 | Out-String
if ($whoami -match "not authenticated") {
    Write-Host "`nYou are NOT logged in. Running wrangler login now..." -ForegroundColor Yellow
    Write-Host "A browser window will open — sign in to Cloudflare and approve access.`n"
    npx wrangler login
}

$toml = Get-Content "wrangler.toml" -Raw
if ($toml -match "YOUR_KV_NAMESPACE_ID") {
    Write-Host "`nKV namespace not configured yet." -ForegroundColor Yellow
    Write-Host "Creating SLACKER_KV namespace...`n"
    npx wrangler kv namespace create SLACKER_KV
    Write-Host "`n>>> COPY the 'id' from the output above." -ForegroundColor Green
    Write-Host ">>> Open wrangler.toml and replace YOUR_KV_NAMESPACE_ID with that id." -ForegroundColor Green
    Write-Host ">>> Then run this script again:  .\deploy.ps1`n"
    exit 0
}

Write-Host "Deploying worker..." -ForegroundColor Yellow
npx wrangler deploy

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Copy the workers.dev URL above into the Slacker extension popup and click Save.`n"
