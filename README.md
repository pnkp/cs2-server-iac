# CS2 Server AWS CDK (TypeScript)

Kompletna infrastruktura AWS CDK do uruchomienia dedykowanego serwera Counter-Strike 2 jednym poleceniem `cdk deploy`.

## Architektura & Optymalizacja Kosztów
- **VPC & Sieć**: 1 strefa dostępności, tylko publiczna podsieć (brak drogiego NAT Gateway — oszczędność ~$32/mc).
- **Compute**: Instancja EC2 `c6i.xlarge` (4 vCPU, 8 GB RAM, zoptymalizowana pod obliczenia/tickrate CS2).
- **Storage**: 80 GB GP3 EBS (wysokie IOPS pod szybkie ładowanie map).
- **Statyczny IP**: Elastic IP przypisany na stałe (brak zmiany IP po restarcie).
- **Bezpieczeństwo**: Zarządzanie przez AWS Systems Manager (SSM Session Manager) bez konieczności otwierania portu SSH (22) ani kluczy SSH.
- **Porty**: Otwarte tylko porty CS2 (UDP 27015, TCP 27015, UDP 27020, UDP 27005, UDP 51840).
- **Konteneryzacja**: Serwer CS2 zarządzany jako usługa `systemd` z automatycznym restartem i pobieraniem aktualizacji.

---

## Wymagania wstępne
1. Node.js >= 18 oraz npm.
2. AWS CLI skonfigurowane z uprawnieniami (`aws configure`).
3. Zainicjalizowane środowisko CDK (`npx cdk bootstrap aws://ACCOUNT-ID/REGION`).
4. (Opcjonalnie) Token GSLT z [Steam Game Server Account Management](https://steamcommunity.com/dev/managegameservers) (App ID: `730`).

---

## Szybki start (1-Click Deploy)

1. **Instalacja zależności**:
   ```bash
   npm install
   ```

2. **Wdrożenie domyślne**:
   ```bash
   npx cdk deploy
   ```

3. **Wdrożenie ze zmiennymi (rekomendowane)**:
   ```bash
   npx cdk deploy \
     -c gsltToken="TWOJ_STEAM_GSLT_TOKEN" \
     -c serverName="Polski CS2 Serwer" \
     -c rconPassword="MocneHasloRcon123!" \
     -c serverPassword="haslo_do_serwera" \
     -c startMap="de_mirage" \
     -c maxPlayers="10"
   ```

---

## Parametry konfiguracyjne (`cdk.json` lub `-c klucz=wartosc`)

| Parametr | Domyślna wartość | Opis |
| :--- | :--- | :--- |
| `serverName` | `"CS2 Dedicated Server"` | Nazwa serwera widoczna na liście |
| `serverPassword` | `""` (puste) | Hasło dostępu do serwera (opcjonalne) |
| `rconPassword` | `"ChangeMeCS2Rcon123!"` | Hasło administracyjne RCON |
| `gsltToken` | `""` | Steam Game Server Login Token (wymagany do publicznej widoczności) |
| `startMap` | `"de_dust2"` | Mapa startowa (`de_mirage`, `de_inferno`, `de_nuke` itd.) |
| `maxPlayers` | `"10"` | Maksymalna liczba graczy |
| `gameMode` | `"1"` | Tryb gry (`0` = Casual, `1` = Competitive, `2` = Wingman) |
| `gameType` | `"0"` | Typ gry (`0` = Classic) |
| `instanceType` | `"c6i.xlarge"` | Typ instancji EC2 (`c6i.xlarge`, `c6a.xlarge`, `c7i.xlarge`) |
| `volumeSizeGb` | `80` | Rozmiar dysku EBS GP3 w GB |

---

## Połączenie z serwerem

Po zakończeniu wdrożenia CDK wyświetli w sekcji Outputs:
- **`ServerPublicIpOutput`**: Publiczny adres IP serwera.
- **`GameConnectCommand`**: Gotowa komenda do wklejenia w konsoli CS2 (klawisz `~`), np. `connect 1.2.3.4:27015`.
- **`SsmSessionCommand`**: Gotowa komenda AWS CLI do otwarcia bezpiecznej konsoli bash serwera bez SSH.

### Logi serwera na żywo:
```bash
aws ssm start-session --target <InstanceId>
sudo docker logs -f cs2-server
```

---

## Usunięcie infrastruktury
Gdy serwer nie jest już potrzebny:
```bash
npx cdk destroy
```
