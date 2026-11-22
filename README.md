# RunRewards

- `backend/`  Node + Express API (Strava login, MongoDB storage). Hosted on Render.
- `app/`      App.js and config.js to drop into your Expo project (`mobile/`).

## 1. MongoDB Atlas (free)
1. Sign up at https://www.mongodb.com/atlas and create a free M0 cluster.
2. Database Access > Add user (username + password). Save the password.
3. Network Access > Add IP Address > Allow access from anywhere (0.0.0.0/0). Render's free tier has no fixed IP.
4. Connect > Drivers > copy the connection string and put your password in it. This is MONGODB_URI.

## 2. GitHub
    git init
    git add .
    git commit -m "RunRewards prototype"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/runrewards.git
    git push -u origin main
(Create the empty repo on github.com first. .env is git-ignored so your secrets stay local.)

## 3. Render
1. New > Web Service > connect your GitHub repo.
2. Root Directory: backend | Build Command: npm install | Start Command: npm start | Instance: Free.
3. Environment variables: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, MONGODB_URI.
4. Deploy. Copy your URL (https://NAME.onrender.com), then add PUBLIC_URL with that value and redeploy.

## 4. Strava
At https://www.strava.com/settings/api set "Authorization Callback Domain" to NAME.onrender.com (no https://).

## 5. Mobile app
    npx create-expo-app@latest mobile --template blank
    cd mobile
    npx expo install expo-web-browser expo-linking @react-native-async-storage/async-storage
Copy app/App.js over mobile/App.js, copy app/config.js into mobile/, set BACKEND_URL to your Render URL, then `npx expo start` and scan the QR code with Expo Go.
