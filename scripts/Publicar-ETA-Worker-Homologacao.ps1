# Publica SOMENTE o Worker isolado eta-qa. Não modifica produção.
$ErrorActionPreference = 'Stop'
$worker = Join-Path (Split-Path $PSScriptRoot -Parent) 'gps-worker'
Set-Location -LiteralPath $worker
if (-not (Test-Path -LiteralPath '.\wrangler.toml')) {
    throw 'Configuração do Worker não encontrada.'
}
$wrangler = Get-Content -LiteralPath '.\wrangler.toml' -Raw -Encoding UTF8
if ($wrangler -notmatch '\[env\.eta-qa\]' -or
    $wrangler -notmatch 'name\s*=\s*"externo-bh-gps-eta-qa"') {
    throw 'Ambiente eta-qa não está configurado; publicação bloqueada.'
}
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node.js / npx não encontrado.'
}
Write-Host 'Publicando SOMENTE externo-bh-gps-eta-qa, nunca externo-bh-gps-free.'
& npx.cmd --yes wrangler@4 deploy --env eta-qa
if ($LASTEXITCODE -ne 0) {
    throw 'Worker QA não publicado. Se necessário, execute npx wrangler@4 login.'
}
$base='https://externo-bh-gps-eta-qa.hubufmg.workers.dev'
Write-Host "Worker QA publicado: $base"
foreach ($path in @('/api/gps/capabilities',
    '/api/arrivals?stop=14791950&routes=51',
    '/api/alerts?stop=14791950&routes=51')) {
    try {
        $url=$base+$path
        $response=Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 20
        Write-Host "$path : OK | source=$($response.source) | available=$($response.available)"
    } catch {
        Write-Warning "Endpoint não respondeu corretamente: $path - $($_.Exception.Message)"
    }
}
Write-Host 'Nenhum deploy Firebase ou Worker de produção foi executado.'
