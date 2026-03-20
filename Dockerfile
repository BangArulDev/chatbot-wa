# Gunakan image resmi Node.js versi 20 (Dibutuhkan secara wajib oleh Baileys)
FROM node:20-bullseye-slim

# Set direktori kerja di dalam kontainer
WORKDIR /usr/src/app

# Salin file konfigurasi npm (package.json dan package-lock.json jika ada)
COPY package*.json ./

# Install dependensi (Kini jauh lebih cepat karena murni instalasi NPM, bebas instalasi sistem operasi Chrome yang berat)
RUN npm install

# Salin seluruh sisa kode eksekusi
COPY . .

# Ekspose port 8000 untuk server Express (menyesuaikan tipe infrastruktur cloud seperti Koyeb/Render)
EXPOSE 8000

# Perintah menjalankan index.js
CMD [ "npm", "start" ]
