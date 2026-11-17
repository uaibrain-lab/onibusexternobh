$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$py = Get-Command py -ErrorAction SilentlyContinue
if ($py) {
    & py -3 --version
    if ($LASTEXITCODE -ne 0) { throw 'Python 3 nao disponivel em py -3.' }
    & py -3 .\server.py --open
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { throw 'Instale o Python 3.9+ ou execute python server.py --open' }
    & python --version
    & python .\server.py --open
}
