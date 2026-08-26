# Генерирует самоподписанный тестовый сертификат код-подписи для Remote Hub.
#
# Реальный код-подписывающий сертификат выдаёт УЦ (DigiCert, Sectigo, GlobalSign…)
# после проверки владельца — его невозможно создать локально. Этот скрипт нужен,
# чтобы проверить ПАЙПЛАЙН подписанной сборки (signtool → timestamp → electron-updater)
# до получения реального PFX.
#
# Важно: CN сертификата должен совпадать с win.signtoolOptions.publisherName
# ("Remote Hub") — по нему electron-updater сверяет подпись обновления.
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File scripts/make-test-cert.ps1          # только PFX
#   powershell -ExecutionPolicy Bypass -File scripts/make-test-cert.ps1 -Trust    # + доверие Windows
#
# Результат:
#   certs/remote-hub-test.pfx   — сертификат с приватным ключом (пароль "remotehub-test")
#   certs/remote-hub-test.cer   — публичный сертификат (для доверия/отладки)
#
# certs/ добавлен в .gitignore — приватный ключ не должен попасть в git.

param(
  [switch]$Trust
)

$ErrorActionPreference = 'Stop'

$certsDir = Join-Path $PSScriptRoot '..\certs'
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null

$pfxPath = Join-Path $certsDir 'remote-hub-test.pfx'
$cerPath = Join-Path $certsDir 'remote-hub-test.cer'
$password = 'remotehub-test'
$secure = ConvertTo-SecureString -String $password -Force -AsPlainText

# CN должен совпадать с publisherName в package.json (build.win.signtoolOptions).
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject 'CN=Remote Hub' `
  -KeyUsage DigitalSignature `
  -KeyExportPolicy Exportable `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(3)

try {
  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
  Write-Host "PFX: $pfxPath (пароль: $password)"
  Write-Host "CER: $cerPath"

  if ($Trust) {
    Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    Write-Host 'Сертификат добавлен в CurrentUser\Root (доверие Windows) — Get-AuthenticodeSignature вернёт Valid.'
    Write-Host 'После проверки удалите его: Remove-Item Cert:\CurrentUser\Root\<thumbprint>'
  }

  Write-Host ''
  Write-Host 'Сборка с подписью (тест, без изменения версии):'
  Write-Host "  `$env:CSC_LINK = '$pfxPath'"
  Write-Host "  `$env:CSC_KEY_PASSWORD = '$password'"
  Write-Host '  npx electron-builder --win --x64 --config.directories.output=release-signed'
} finally {
  # Тестовый ключ в хранилище не нужен — приватный ключ лежит в PFX.
  Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
}
