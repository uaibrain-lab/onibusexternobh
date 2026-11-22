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
$origin='https://hubufmg--homologacao-exbdd4qe.web.app'
$headers=@{Origin=$origin;Accept='application/json'}
Write-Host "Worker QA publicado: $base"
Write-Host 'Conferindo CORS, endpoints novos e disponibilidade do feed...'

function Check-EtaEndpoint([string]$path, [string]$source) {
    $url=$base+$path
    try {
        $http=Invoke-WebRequest -Uri $url -Method Get -Headers $headers -TimeoutSec 20 -UseBasicParsing
    } catch {
        throw "Deploy ocorreu, mas $path falhou na verificacao HTTPS: $($_.Exception.Message)"
    }
    if ($http.StatusCode -ne 200 -or
        $http.Headers['Access-Control-Allow-Origin'] -ne $origin) {
        throw "Deploy ocorreu, mas $path nao respondeu 200/CORS valido."
    }
    $data=$http.Content | ConvertFrom-Json
    if ($source -eq 'capabilities') {
        if ($data.tripUpdatesSupported -ne $true -or
            $data.serviceAlertsSupported -ne $true) {
            throw "Worker publicado nao oferece os dois endpoints exigidos."
        }
    } else {
        if ($data.available -ne $true -or $data.source -ne $source) {
            throw "Worker $path respondeu, mas feed SUMOB nao esta validado."
        }
        if (-not $data.feedTimestamp) {
            throw "Worker $path respondeu sem carimbo de feed oficial."
        }
        $feedAt=[datetimeoffset]::Parse($data.feedTimestamp)
        if ([math]::Abs(([datetimeoffset]::UtcNow-$feedAt).TotalSeconds) -gt 600) {
            throw "Worker $path respondeu com feed antigo."
        }
    }
    Write-Host "$path : VALIDADO"
}

Check-EtaEndpoint '/api/gps/capabilities' 'capabilities'
Check-EtaEndpoint '/api/arrivals?stop=14791950&routes=51' 'SUMOB_GTFS_RT_TRIP_UPDATES'
Check-EtaEndpoint '/api/alerts?stop=14791950&routes=51' 'SUMOB_GTFS_RT_ALERTS'
Write-Host 'WORKER_ETA_QA_OK - Nenhum deploy Firebase ou Worker de producao foi executado.'
