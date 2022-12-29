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

module.exports = { checkUserPermissions, getUserMC, getUserBanStatus };