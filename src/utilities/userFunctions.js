const { executeMysqlQuery } = require("./mysqlHelper");

async function checkUserPermissions(discord_id) {
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [discord_id]);

    if (user.length <= 0) return 0;

    let userPermission = user[0].permission_level;
    return userPermission;
}

module.exports = { checkUserPermissions };