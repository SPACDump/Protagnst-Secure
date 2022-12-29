const { encrypt } = require("./aes");
const { executeMysqlQuery } = require("./mysqlHelper");

async function globalCheckHelper(discord_id) {
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [discord_id]);

    if (user.length <= 0) return false;

    return user[0];
}

async function checkUserPermissions(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return 0;

    return user.permission_level || 0;
}

async function getUserMC(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return "None";
    
    return user.minecraft_name || "None";
}

async function getUserBanStatus(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return false;

    return user.is_banned || false;
}

async function refreshAccessToken(refresh_token, discord_id) {
    let data = await fetch(`https://discord.com/api/oauth2/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refresh_token,
        })
    });

    let json = await data.json();

    console.log(json.refresh_token);
    let newRefreshToken = encrypt(json.refresh_token);
    await executeMysqlQuery(`UPDATE users SET refresh_token = ? WHERE discord_id = ?`, [newRefreshToken, discord_id]);

    return json.access_token;
}

async function putUserInGuild(access_token, user_id, guild_id, roles) {
    let userMC = await getUserMC(user_id);

    let data = await fetch(`https://discord.com/api/v10/guilds/${guild_id}/members/${user_id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${process.env.BOT_TOKEN}`
        },
        body: JSON.stringify({
            access_token: access_token,
            nick: userMC,
            roles: roles,
        })
    }).catch(err => {
        console.log(err);
        return false;
    });

    return true;
}

module.exports = { checkUserPermissions, getUserMC, getUserBanStatus, refreshAccessToken, putUserInGuild };