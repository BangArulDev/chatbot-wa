FROM node:18-bullseye-slim

# Install dependencies yang dibutuhkan oleh Puppeteer (Chromium) untuk WhatsApp Web JS
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Buat dan pindah ke working directory untuk aplikasi
WORKDIR /usr/src/app

# Salin package.json dan package-lock.json
COPY package*.json ./

# Install dependensi node (termasuk whatsapp-web.js dll)
RUN npm install

# Salin seluruh kode sisa proyek
COPY . .

# Ekspose port 8000 untuk server Express (menyesuaikan tipe infrastruktur Koyeb)
EXPOSE 8000

# Jalankan index.js
CMD [ "npm", "start" ]
