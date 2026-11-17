param(
    [string]$Destino = "$env:USERPROFILE\Downloads\onibusexternobh-git",
    [string]$Branch = "feat/externo-hub-p2-20261117"
)
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/uaibrain-lab/onibusexternobh.git'
$fonte = $PSScriptRoot
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Instale Git for Windows.' }
if (-not (Test-Path -LiteralPath (Join-Path $fonte 'server.py'))) { throw 'Execute a partir da pasta do pacote P2.' }
if (Test-Path -LiteralPath $Destino) {
    if (-not (Test-Path -LiteralPath (Join-Path $Destino '.git'))) { throw 'Destino existe, mas nao e repositorio Git. Use outro caminho.' }
    $mudancas = & git -C $Destino status --porcelain
    if ($LASTEXITCODE -ne 0 -or $mudancas) { throw 'Repositorio de destino com alteracoes locais. Nada foi sobrescrito.' }
    & git -C $Destino fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar origin/main.' }
    & git -C $Destino switch main
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao trocar para main.' }
    & git -C $Destino pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel atualizar main via fast-forward.' }
} else {
    & git clone $repo $Destino
    if ($LASTEXITCODE -ne 0) { throw 'Falha no clone: confira autenticacao GitHub.' }
}
$existe = & git -C $Destino show-ref --verify --quiet "refs/heads/$Branch" 2>$null
if ($LASTEXITCODE -eq 0) { throw "Branch local $Branch ja existe. Use outro nome." }
& git -C $Destino switch -c $Branch
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar branch.' }
$itens = @('README.md','THIRD_PARTY_NOTICES.md','.gitignore','server.py','INICIAR-WINDOWS.ps1','PUBLICAR-GITHUB-WINDOWS.ps1','static','transit','tests','catalog','docs')
foreach ($item in $itens) {
    $origem = Join-Path $fonte $item
    if (-not (Test-Path -LiteralPath $origem)) { throw "Faltando: $origem" }
    $alvo = Join-Path $Destino $item
    if (Test-Path -LiteralPath $alvo) { Remove-Item -LiteralPath $alvo -Recurse -Force }
    Copy-Item -LiteralPath $origem -Destination $alvo -Recurse -Force
}
& git -C $Destino add README.md THIRD_PARTY_NOTICES.md .gitignore server.py INICIAR-WINDOWS.ps1 PUBLICAR-GITHUB-WINDOWS.ps1 static transit tests catalog docs
if ($LASTEXITCODE -ne 0) { throw 'git add falhou.' }
& git -C $Destino diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Erros de whitespace no diff.' }
& git -C $Destino commit -m 'feat: rastreador P2 com UI Externo no padrao Interno Hub UFMG'
if ($LASTEXITCODE -ne 0) { throw 'Falha no commit. Confira git user.name/user.email.' }
& git -C $Destino push -u origin $Branch
if ($LASTEXITCODE -ne 0) { throw 'Falha no push. Verifique permissoes GitHub.' }
Write-Host "\nBranch enviada. Codigo em: https://github.com/uaibrain-lab/onibusexternobh/tree/$Branch" -ForegroundColor Green
Write-Host 'A main e os sites publicados permanecem intactos.'
