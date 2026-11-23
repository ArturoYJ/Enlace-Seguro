# Despliegue en AWS (EC2 + MongoDB Atlas)

Todo corre en una sola EC2 con Docker. La base de datos está en MongoDB Atlas y la API se conecta con TLS. Desde Internet solo se ve Caddy, en los puertos 80 y 443.

```
App móvil ──HTTPS──> Caddy (EC2) ──> API ──TLS──> MongoDB Atlas
                                      │
                                      └──HTTPS (CA interna de Caddy)──> Sandbox ──> Envoy ──> Internet
                                                                          │
                                                                          └──> DNS (CoreDNS)
```

Qué protege cada pieza:

- Caddy saca y renueva solo el certificado de Let's Encrypt para el dominio de DuckDNS. Solo deja pasar `/api/v1/*`.
- La API solo acepta una conexión a Mongo con TLS y validación de certificado cuando `NODE_ENV=production` (`mongoUriPolicy.ts`). También exige HTTPS hacia el Sandbox; ese tramo lo cifra Caddy con su CA interna.
- El Sandbox vive en una red de Docker sin salida a Internet. Chromium solo puede salir por Envoy, que bloquea IP privadas, la dirección de metadatos de AWS (`169.254.169.254`) y los puertos fuera de 80 y 443. El contenedor corre sin privilegios, con sistema de archivos de solo lectura y el perfil seccomp del repo.
- Ningún puerto interno (3000, 3001, 10000, 53) se publica.

## 1. MongoDB Atlas

1. Crea una cuenta en mongodb.com/atlas y un clúster gratis **M0** en AWS, región **us-east-1** (la misma de AWS Academy).
2. En **Database Access** crea un usuario con contraseña larga y el rol "Read and write to any database".
3. En **Network Access** agrega la Elastic IP de tu EC2 (paso 2). No uses `0.0.0.0/0`.
4. En **Connect > Drivers** copia la cadena `mongodb+srv://...`. Esa forma ya usa TLS.

## 2. EC2 en AWS Academy

1. Abre el Learner Lab y entra a la consola de EC2.
2. Lanza una instancia:
   - AMI: **Amazon Linux 2023**.
   - Tipo: **t3.medium** (Chromium y la compilación de imágenes no caben en una micro).
   - Disco: 20 GB.
   - Key pair: crea uno y guarda el `.pem`.
   - En "Advanced details": **Metadata version: V2 only** y **Metadata response hop limit: 1**. Así ningún contenedor puede leer las credenciales de la instancia.
3. Security Group, reglas de entrada:
   - SSH 22 solo desde **My IP**.
   - HTTP 80 y HTTPS 443 desde cualquier lugar.
   - Nada más.
4. En **Elastic IPs** crea una y asóciala a la instancia. Sin ella, la IP cambia cada vez que se reinicia el laboratorio.

## 3. Dominio en DuckDNS

Entra a duckdns.org con tu cuenta de GitHub, crea un subdominio (por ejemplo `enlaceseguro-demo`) y ponle la Elastic IP. Te queda `enlaceseguro-demo.duckdns.org`.

## 4. Preparar la EC2

Desde Git Bash, en la carpeta donde está tu `.pem`:

```sh
chmod 400 mi-llave.pem
ssh -i mi-llave.pem ec2-user@TU_ELASTIC_IP
```

Ya dentro:

```sh
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sSL https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
exit
```

Vuelve a entrar por SSH para que tome el grupo `docker`, y clona el repo:

```sh
git clone https://github.com/ArturoYJ/Enlace-Seguro.git
cd Enlace-Seguro
```

## 5. Configurar y arrancar

```sh
bash deploy/aws/init-env.sh
nano deploy/aws/.env
```

En el archivo cambia `DOMAIN` por tu subdominio y `MONGODB_URI` por la cadena de Atlas. Los secretos ya vienen generados. Si quieres VirusTotal o la demo de logins, activa esas variables ahí mismo.

```sh
cd deploy/aws
docker compose up -d --build
docker compose ps
```

La primera vez tarda unos 10 minutos, porque descarga Chromium. Cuando todos los servicios digan `healthy` o `running`, prueba:

```sh
curl https://TU_SUBDOMINIO.duckdns.org/api/v1/health
```

## 6. Conectar la app

En `frontend/mobile/.env.local` de tu computadora:

```
EXPO_PUBLIC_API_URL=https://TU_SUBDOMINIO.duckdns.org/api/v1
```

Reinicia Expo con `npx expo start --clear`. Ya no hace falta tener la API ni el Sandbox corriendo en tu laptop.

## Día a día en el Learner Lab

- Al cerrar la sesión del laboratorio la EC2 se apaga. Al volver, los contenedores arrancan solos (`restart: unless-stopped`). Si no, entra por SSH y corre `docker compose up -d` en `deploy/aws`.
- Para actualizar después de un merge: `git pull` y `docker compose up -d --build`.
- Logs: `docker compose logs -f api sandbox`.
- El `.env` nunca se sube al repo; ya está en `.gitignore`.
