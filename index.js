require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { PrismaClient } = require('@prisma/client');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// --- CONFIGURATIONS ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8607967545:AAHBB_jUS1vpyPbJmPgMtYgNlSZEAJVR7qo";
const OWNER_ID = parseInt(process.env.ADMIN_ID || "8037371175");

const bot = new Telegraf(BOT_TOKEN); 

const LIMITS = { free: 5, silver: 20, gold: 50, diamond: 100, owner: 999999 };
const PRICING = { silver: '10 TK', gold: '50 TK', diamond: '100 TK' };

// --- UTILS ---
async function getUser(userId, name = "User") {
    let user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user) {
        const role = userId === OWNER_ID ? 'owner' : 'free';
        user = await prisma.user.create({
            data: { id: BigInt(userId), name: name, role: role }
        });
    }

    if (user.role !== 'free' && user.role !== 'owner' && user.role_expires_at) {
        if (new Date() > user.role_expires_at) {
            user = await prisma.user.update({
                where: { id: BigInt(userId) },
                data: { role: 'free', role_expires_at: null }
            });
            try { bot.telegram.sendMessage(userId, "⚠️ আপনার Premium প্ল্যানের মেয়াদ শেষ! আপনি এখন Free প্ল্যানে আছেন।"); } catch(e){}
        }
    }
    return user;
}

// ==========================================
// 🚀 1. TELEGRAM BOT LOGIC
// ==========================================

bot.start(async (ctx) => {
    const user = await getUser(ctx.from.id, ctx.from.first_name);
    if (user.is_banned) return ctx.reply("❌ You are banned from using this bot.");

    const totalUsers = await prisma.user.count();
    const text = `🚀 **Hello ${ctx.from.first_name}, Welcome to AURA Downloader!**\n\nDrop any video link to start downloading instantly.\n\n👑 **Role:** \`${user.role.toUpperCase()}\`\n📥 **Usage:** \`${user.daily_downloads} / ${LIMITS[user.role]}\`\n👥 **Community:** \`${totalUsers} Users\``;
    
    ctx.replyWithMarkdown(text);
});

bot.command('spin', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (user.daily_downloads < LIMITS[user.role] && user.role !== 'owner') {
        return ctx.replyWithMarkdown(`⚠️ **আপনার এখনো লিমিট বাকি আছে!**\nআজকের লিমিট (${LIMITS[user.role]}) শেষ হলেই আপনি Lucky Spin 🎰 খেলতে পারবেন।`);
    }

    const today = new Date().toISOString().split('T')[0];
    const lastSpin = user.last_spin ? user.last_spin.toISOString().split('T')[0] : null;

    if (lastSpin === today) return ctx.reply("⚠️ আপনি আজকে অলরেডি Spin করেছেন! কাল আবার ট্রাই করুন।");

    await ctx.reply("🎰 **Spinning the wheel...**");
    
    const chance = Math.floor(Math.random() * 100) + 1;
    let resultText = "";
    let updates = { last_spin: new Date() };

    if (chance <= 10) {
        updates.role = 'silver';
        updates.role_expires_at = new Date(Date.now() + 60 * 60 * 1000); 
        updates.daily_downloads = 0;
        resultText = "🎉 **JACKPOT!** আপনি পেয়েছেন **1 Hour Silver Plan**! Enjoy unlimited fast downloads for 1 hr.";
    } else if (chance <= 30) {
        updates.daily_downloads = Math.max(0, user.daily_downloads - 3);
        resultText = "🎁 **Awesome!** আপনি পেয়েছেন **+3 Extra Downloads** আজকের জন্য!";
    } else if (chance <= 60) {
        updates.daily_downloads = Math.max(0, user.daily_downloads - 1);
        resultText = "🎁 **Good!** আপনি পেয়েছেন **+1 Extra Download** আজকের জন্য!";
    } else {
        resultText = "💔 **Better luck next time!** আজকে কিছু জিতেন নি। কালকে আবার ট্রাই করুন!";
    }

    await prisma.user.update({ where: { id: BigInt(ctx.from.id) }, data: updates });
    setTimeout(() => ctx.replyWithMarkdown(resultText), 1500);
});

bot.command('gencode', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.replyWithMarkdown("⚠️ **ভুল ফরম্যাট!**\nUse: `/gencode [role] [hours]`\nExample: `/gencode silver 24`");

    const role = args[1].toLowerCase();
    const hours = parseInt(args[2]);
    if (!['silver', 'gold', 'diamond'].includes(role)) return ctx.reply("❌ Invalid role.");

    const code = `AURA-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${role.toUpperCase()}`;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await prisma.redeemCode.create({
        data: { code, role_granted: role, expires_at: expiresAt }
    });

    ctx.replyWithMarkdown(`🎁 **Code Generated!**\n\n👑 Role: \`${role.toUpperCase()}\`\n⏳ Validity: \`${hours} Hours\`\n🎟 Code: \`${code}\``);
});

bot.command('redeem', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.replyWithMarkdown("Use: `/redeem AURA-CODE`");

    const codeInput = args[1].trim();
    const user = await getUser(ctx.from.id);
    
    if (user.is_banned) return;

    const today = new Date().toISOString().split('T')[0];
    const lastRedeem = user.last_code_used ? user.last_code_used.toISOString().split('T')[0] : null;
    if (lastRedeem === today) return ctx.reply("❌ আপনি আজকে অলরেডি একটি রিডিম কোড ব্যবহার করেছেন। কাল আবার ট্রাই করুন।");

    const rc = await prisma.redeemCode.findUnique({ where: { code: codeInput } });
    if (!rc) return ctx.reply("❌ Invalid Code.");
    if (rc.is_used) return ctx.reply("❌ এই কোডটি অলরেডি ব্যবহার করা হয়েছে।");
    if (rc.expires_at && new Date() > rc.expires_at) return ctx.reply("❌ এই কোডটি Expire হয়ে গেছে!");

    await prisma.user.update({
        where: { id: BigInt(ctx.from.id) },
        data: {
            role: rc.role_granted,
            role_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), 
            last_code_used: new Date(),
            daily_downloads: 0
        }
    });

    await prisma.redeemCode.update({
        where: { code: codeInput },
        data: { is_used: true, used_by_id: BigInt(ctx.from.id) }
    });

    ctx.replyWithMarkdown(`✅ **Success!**\nআপনি এখন **${rc.role_granted.toUpperCase()}** প্ল্যানে আছেন। Enjoy!`);
});

bot.hears(/http[s]?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/, async (ctx) => {
    const url = ctx.message.text.trim();
    const user = await getUser(ctx.from.id);
    
    if (user.role !== 'owner' && user.daily_downloads >= LIMITS[user.role]) {
        return ctx.replyWithMarkdown(`❌ **আপনার আজকের Download Limit শেষ! (${LIMITS[user.role]}/${LIMITS[user.role]})**\n\nওয়েবসাইট থেকে লিমিট আপগ্রেড করুন অথবা কালকের জন্য অপেক্ষা করুন!`);
    }

    const msg = await ctx.reply("⏳ Processing your link...");

    try {
        if (user.role !== 'owner') {
            await prisma.user.update({
                where: { id: BigInt(user.id) },
                data: { daily_downloads: { increment: 1 }, total_downloads: { increment: 1 } }
            });
        }

        const appUrl = process.env.PUBLIC_URL || "http://localhost:8080"; 
        const downloadLink = `${appUrl}/api/download?url=${encodeURIComponent(url)}&format=video&uid=${user.id}`;
        
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ **Link Processed!**\n\n📥 [Click Here to Download Video](${downloadLink})`, { parse_mode: 'Markdown' });

    } catch (e) {
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "❌ Download failed. The video might be private.");
    }
});


// ==========================================
// 🌐 2. WEB PLATFORM APIs (Aura Downloader Web)
// ==========================================

// 🛡️ ANTI-BLOCK HEADERS FOR CLOUD SERVERS
const ytDlpOptions = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
};

// Web Link Analyzer API
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
        console.log(`[AURA DL] Analyzing URL: ${url}`);
        
        // Pass the anti-block options to youtube-dl-exec
        const info = await youtubedl(url, ytDlpOptions);

        res.json({
            success: true,
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration_string || info.duration || '00:00',
            platform: info.extractor_key || 'Unknown'
        });
    } catch (error) {
        // Detailed error logging to check Railway logs if it fails again
        console.error("[YT-DLP ERROR]:", error.message || error);
        res.status(500).json({ success: false, error: "Failed to extract info. Link might be private, or server is temporarily blocked." });
    }
});

// Web Download Execution API
app.get('/api/download', async (req, res) => {
    const { url, format, uid } = req.query; 
    if (!url || !format) return res.status(400).send("Missing URL or format.");

    try {
        let user;
        if(uid) {
            user = await prisma.user.findUnique({ where: { id: BigInt(uid) } });
            if(user && user.role !== 'owner' && user.daily_downloads >= LIMITS[user.role]) {
                return res.status(403).send("Download Limit Exceeded. Upgrade your plan.");
            }
        }

        // Get basic info first
        const info = await youtubedl(url, ytDlpOptions);
        let title = info.title.replace(/[^\w\s-]/gi, '').substring(0, 50);
        let filename = `${title}_AURA.${format === 'audio' ? 'mp3' : 'mp4'}`;
        
        // Clone options for download execution
        let downloadFlags = { ...ytDlpOptions };
        delete downloadFlags.dumpSingleJson; 

        if (format === 'audio') {
            downloadFlags.extractAudio = true;
            downloadFlags.audioFormat = 'mp3';
            res.header('Content-Disposition', `attachment; filename="${filename}"`);
            res.header('Content-Type', 'audio/mpeg');
        } else if (format === 'thumbnail') {
            return res.redirect(info.thumbnail);
        } else {
            downloadFlags.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
            res.header('Content-Disposition', `attachment; filename="${filename}"`);
            res.header('Content-Type', 'video/mp4');
        }

        if(user && user.role !== 'owner') {
            await prisma.user.update({
                where: { id: BigInt(uid) },
                data: { daily_downloads: { increment: 1 }, total_downloads: { increment: 1 } }
            });
        }

        const stream = youtubedl.exec(url, downloadFlags, { stdio: ['ignore', 'pipe', 'ignore'] });
        stream.stdout.pipe(res);

    } catch (error) {
        console.error("[YT-DLP DOWNLOAD ERROR]:", error.message || error);
        if (!res.headersSent) res.status(500).send("Error initiating download.");
    }
});

// Web User Authentication
app.post('/api/auth/web-login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user && user.password === password) {
        const safeUser = {
            id: user.id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            daily_downloads: user.daily_downloads,
            limit: LIMITS[user.role],
            total_downloads: user.total_downloads
        };
        res.json({ success: true, user: safeUser });
    } else {
        res.status(401).json({ success: false, error: "Invalid credentials" });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const usersCount = await prisma.user.count();
        const allUsers = await prisma.user.findMany();
        const totalDl = allUsers.reduce((sum, u) => sum + u.total_downloads, 0);
        const premUsers = allUsers.filter(u => u.role !== 'free').length;

        res.json({ success: true, users: usersCount, downloads: totalDl, premium: premUsers });
    } catch(e) {
        res.json({ success: false });
    }
});

// ==========================================
// 🌐 3. FRONTEND ROUTES
// ==========================================
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'sw.js')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==========================================
// 🚀 4. SERVER & BOT STARTUP
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 AURA Downloader Server is running on port ${PORT}`);
});

bot.launch().then(() => console.log("🤖 Telegram Bot Started!")).catch(err => console.error("Bot Launch Error:", err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
