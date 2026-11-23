# Troca o namespace de exemplo (n3-nome1-nome2) pelo seu em todos os arquivos do projeto.
#
# Uso (PowerShell, na pasta raiz do projeto):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\extras\trocar-namespace.ps1 -Novo n3-seunome1-seunome2
#
# Por que um script e não "Set-Content"? O Windows PowerShell 5.1 grava em ANSI por
# padrão e estragaria os acentos dos comentários. Aqui gravamos em UTF-8 SEM BOM.

param(
    [Parameter(Mandatory = $true)]
    [string]$Novo
)

$antigo = 'n3-nome1-nome2'

# Namespace do Kubernetes: minúsculas, números e hífen (máx. 63 caracteres).
if ($Novo -notmatch '^n3-[a-z0-9]([a-z0-9-]*[a-z0-9])?$' -or $Novo.Length -gt 63) {
    Write-Error "Nome inválido. Use o formato n3-nome1-nome2 (só minúsculas, números e hífen, sem acentos)."
    exit 1
}

$utf8SemBom = New-Object System.Text.UTF8Encoding($false)

$arquivos = @()
$arquivos += Get-ChildItem -Path 'k8s', 'extras' -Filter '*.yaml' -File
$arquivos += Get-Item 'comandos.md', 'README.md'

foreach ($arq in $arquivos) {
    $texto = [System.IO.File]::ReadAllText($arq.FullName, $utf8SemBom)
    if ($texto.Contains($antigo)) {
        [System.IO.File]::WriteAllText($arq.FullName, $texto.Replace($antigo, $Novo), $utf8SemBom)
        Write-Host "Atualizado: $($arq.FullName)"
    }
}
Write-Host "Pronto. Namespace agora é: $Novo"
