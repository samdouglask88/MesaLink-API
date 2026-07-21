# Sobe o Supabase local, serve as Edge Functions e roda os testes de integração.
# Pré-requisito: Docker Desktop instalado E ABERTO (daemon rodando).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/run-integration.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Resolve-Deno {
  $local = Join-Path $env:USERPROFILE ".deno\bin\deno.exe"
  if (Test-Path $local) { return $local }
  $cmd = Get-Command deno -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Deno não encontrado. Instale com: irm https://deno.land/install.ps1 | iex"
}
$deno = Resolve-Deno

# 0. Docker precisa estar de pé.
try { docker info --format '{{.ServerVersion}}' | Out-Null }
catch { throw "Docker não está rodando. Abra o Docker Desktop e espere ficar 'running'." }

Write-Host "==> supabase start (pode demorar na 1a vez, baixa imagens)..." -ForegroundColor Cyan
npx --yes supabase start

# 1. Captura as chaves locais no formato env.
Write-Host "==> lendo chaves (supabase status)..." -ForegroundColor Cyan
$status = npx --yes supabase status -o env
$map = @{}
foreach ($line in $status) {
  if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $map[$matches[1]] = $matches[2] }
}
$env:SUPABASE_URL              = $map["API_URL"]
$env:SUPABASE_ANON_KEY         = $map["ANON_KEY"]
$env:SUPABASE_SERVICE_ROLE_KEY = $map["SERVICE_ROLE_KEY"]
$env:FUNCTIONS_URL             = "$($env:SUPABASE_URL)/functions/v1"
$env:INTEGRATION               = "1"
if (-not $env:SUPABASE_ANON_KEY) { throw "Não consegui ler as chaves do 'supabase status'." }

# 1b. Reset do banco: reaplica TODAS as migrations + seed num estado limpo.
# Garante que cada execução parte de um banco previsível (os testes usam números
# de mesa fixos e colidiriam com dados de uma rodada anterior).
Write-Host "==> supabase db reset (reaplica migrations + seed)..." -ForegroundColor Cyan
npx --yes supabase db reset

# 2. Serve as functions em segundo plano.
Write-Host "==> servindo Edge Functions em background..." -ForegroundColor Cyan
# npx é um .cmd no Windows; Start-Process precisa de um .exe -> lançamos via cmd.exe.
$serve = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx --yes supabase functions serve" `
         -PassThru -WindowStyle Hidden -RedirectStandardOutput "scripts\functions-serve.log" `
         -RedirectStandardError "scripts\functions-serve.err.log"

try {
  # 3. Espera as functions responderem.
  Write-Host "==> aguardando as functions subirem..." -ForegroundColor Cyan
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
      Invoke-WebRequest -Method Options -Uri "$($env:FUNCTIONS_URL)/criar-pedido" -TimeoutSec 3 | Out-Null
      $ok = $true; break
    } catch { }
  }
  if (-not $ok) { Write-Warning "Functions podem não ter subido; veja scripts\functions-serve.err.log" }

  # 4. Roda TODOS os testes (unitários + integração).
  Write-Host "==> deno test (unitários + integração)..." -ForegroundColor Cyan
  & $deno test --allow-net --allow-env supabase/functions/tests/
}
finally {
  Write-Host "==> encerrando functions serve..." -ForegroundColor Cyan
  if ($serve -and -not $serve.HasExited) { Stop-Process -Id $serve.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host "OK. Para derrubar o stack local: npx supabase stop" -ForegroundColor Green
