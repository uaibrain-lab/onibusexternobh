#requires -Version 5.1
<#
P17 - Build and optional deployment of a GPS-only homologation site.
Does not deploy Firebase, edit ru-hoje, enable the normal GPS configuration,
or create paid Cloudflare services. Only the *isolated* Pages project is targeted.
Default action is LOCAL BUILD + checks; public writes need explicit switches.
#>
[CmdletBinding()]
param(
    [switch]$AtualizarWorker,
    [switch]$CriarProjeto,
    [switch]$Publicar
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = "externo-bh-hml-uaibrain"
$branch = "hml-gps"
$expectedUrl = "https://$project.pages.dev/externo/"
$expectedOrigin = "https://$project.pages.dev"
$workerBase = "https://externo-bh-gps-free.hubufmg.workers.dev"
Set-Location -LiteralPath $repo

if ($CriarProjeto -and -not $Publicar) {
    throw "CRIAR_PROJETO_REQUER_PUBLICAR_EXPLICITO"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "GIT_NAO_ENCONTRADO"
}
$remote = (& git remote get-url origin)
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '(?i)uaibrain-lab/onibusexternobh(\.git)?$') {
    throw "REPOSITORIO_NAO_AUTORIZADO: apenas uaibrain-lab/onibusexternobh"
}
$codeBranch = (& git branch --show-current).Trim()
if ($codeBranch -ne "feat/gps-worker-free-homologacao-p15-20261117") {
    throw "BRANCH_INCORRETA: use feat/gps-worker-free-homologacao-p15-20261117"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "NODE_NAO_ENCONTRADO"
}
$python = "python"
$pythonArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
    $python = "py"
    $pythonArgs = @("-3")
} elseif (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "PYTHON_3_NAO_ENCONTRADO"
}
function RunPython([string[]]$argsToRun) {
    & $python @pythonArgs @argsToRun
    if ($LASTEXITCODE -ne 0) {
        throw "PYTHON_TEST_OU_BUILD_FALHOU"
    }
}
function RunWrangler([string[]]$argsToRun) {
    & npx.cmd --yes wrangler @argsToRun
    if ($LASTEXITCODE -ne 0) {
        throw "WRANGLER_FALHOU: $($argsToRun -join ' ')"
    }
}

# Preserve the shared, OFF-by-default GPS source of truth.
$sourceConfigPath = Join-Path $repo "static\gps-config.json"
$sourceBytesBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($sourceConfigPath))
$source = Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json
if ($source.enabled -ne $false) {
    throw "GPS_ORIGINAL_NAO_ESTA_DESATIVADO"
}

& node --check "gps-worker/src/index.mjs"
if ($LASTEXITCODE -ne 0) { throw "WORKER_SINTAXE_FALHOU" }
& node --check "static/live-gps.js"
if ($LASTEXITCODE -ne 0) { throw "ADAPTADOR_SINTAXE_FALHOU" }
& node --test "tests/test_gtfs_realtime_worker.cjs" "tests/test_gtfs_realtime_adapter.cjs" "tests/test_live_gps_adapter.cjs"
if ($LASTEXITCODE -ne 0) { throw "TESTES_GPS_FALHARAM" }
RunPython @("-m", "unittest", "discover", "-s", "tests", "-p", "test_gps_staging_build.py", "-v")
RunPython @("scripts/build_static_site.py", "--gps-staging")

$site = Join-Path $repo "dist\externo"
$stageCfg = Get-Content -LiteralPath (Join-Path $site "gps-config.json") -Raw | ConvertFrom-Json
$page = Get-Content -LiteralPath (Join-Path $site "index.html") -Raw
if ($stageCfg.enabled -ne $true -or $stageCfg.provider -ne "gtfs_rt" -or
    $stageCfg.endpoint -ne "$workerBase/api/gps" -or
    $page -notmatch 'data-gps-homologacao="true"' -or
    $page -notmatch 'noindex,nofollow,noarchive' -or
    -not (Test-Path -LiteralPath (Join-Path $repo "dist\_headers")) -or
    -not (Test-Path -LiteralPath (Join-Path $repo "dist\_redirects"))) {
    throw "PACOTE_NAO_ESTA_ISOLADO_PARA_HOMOLOGACAO"
}
$sourceBytesAfter = [Convert]::ToBase64String([IO.File]::ReadAllBytes($sourceConfigPath))
if ($sourceBytesAfter -ne $sourceBytesBefore) {
    throw "CONFIGURACAO_PUBLICA_FOI_MODIFICADA"
}
$assets = @(Get-ChildItem -LiteralPath (Join-Path $repo "dist") -Recurse -File)
if ($assets.Count -gt 20000 -or @($assets | Where-Object { $_.Length -gt 25MB }).Count -gt 0) {
    throw "PAGES_FREE_LIMITES_DE_ARQUIVOS_EXCEDIDOS"
}
Write-Host "GPS_STAGING_LOCAL_BUILD_OK"
Write-Host ("STAGING_ASSETS=" + $assets.Count)
Write-Host ("STAGING_BYTES=" + (($assets | Measure-Object Length -Sum).Sum))
Write-Host "PUBLIC_GPS_CONFIG_STILL_DISABLED"

if ($AtualizarWorker) {
    if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
        throw "NPM_WRANGLER_NAO_ENCONTRADO"
    }
    Write-Host "WORKER_CORS_UPDATE_REQUESTED: somente externo-bh-gps-free"
    RunWrangler @("deploy", "--config", "gps-worker/wrangler.toml")
}
if ($Publicar) {
    if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
        throw "NPM_WRANGLER_NAO_ENCONTRADO"
    }
    # Require real CORS support before publishing a live-GPS staging page.
    try {
        $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri "$workerBase/api/gps/capabilities" -Headers @{Origin=$expectedOrigin}
    } catch {
        throw "WORKER_CORS_HOMOLOGACAO_INDISPONIVEL: publique CORS com -AtualizarWorker"
    }
    if ($probe.StatusCode -ne 200 -or
        [string]$probe.Headers["Access-Control-Allow-Origin"] -ne $expectedOrigin) {
        throw "WORKER_CORS_ORIGEM_HOMOLOGACAO_NAO_AUTORIZADA"
    }
    if ($CriarProjeto) {
        Write-Host "CREATING_ONLY_ISOLATED_PAGES_PROJECT=$project"
        RunWrangler @("pages", "project", "create", $project, "--production-branch", $branch)
    }
    Write-Host "DEPLOYING_ONLY_ISOLATED_PAGES_PROJECT=$project"
    RunWrangler @("pages", "deploy", "dist", "--project-name", $project, "--branch", $branch)
    Write-Host "GPS_STAGING_PAGES_DEPLOY_REQUESTED"
    Write-Host "STAGING_EXPECTED_URL=$expectedUrl"
    Write-Host "Confira HTTP 200 no site; nao confunda deploy com validacao funcional."
} else {
    Write-Host "NO_DEPLOY_PERFORMED"
    Write-Host "Use -Publicar -CriarProjeto -AtualizarWorker para primeiro deploy (ou remova -CriarProjeto se ja existir)."
}
