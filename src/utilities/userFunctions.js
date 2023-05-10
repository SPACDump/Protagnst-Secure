const { encrypt } = require("./aes");
const { executeMysqlQuery } = require("./mysqlHelper");

// Function to check if a user is in the database and return the user object so other functions can use it
async function globalCheckHelper(discord_id) {
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [discord_id]);

    if (user.length <= 0) return false;

    return user[0];
}

// Function that uses the global check helper, like all other functions here
// This returns the number (permission level) that the user has
async function checkUserPermissions(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return 0;

    return user.perms || 0;
}

// Function to get the user's minecraft username
async function getUserMC(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return "None";
    
    return user.mc || "None";
}

// Function to get the user's ban status
async function getUserBanStatus(discord_id) {
    let user = await globalCheckHelper(discord_id);
    if (!user) return false;

    return user.is_banned || false;
}

// Function to refresh the user's access token
async function refreshAccessToken(refresh_token, discord_id) {
    // Make request to discord
    let data = await fetch(`https://discord.com/api/oauth2/token`, {
        method: "POST",
        body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refresh_token,
        })
    });

    // If there is an error, return false
    let json = await data.json();
    if (json.error) return false;

    // Encrypt the data using AES
    let newRefreshToken = encrypt(json.refresh_token);
    // Update the database with the new refresh token
    await executeMysqlQuery(`UPDATE users SET refresh = ? WHERE disc = ?`, [newRefreshToken, discord_id]);

    // Return the new access token to use in putUserInGuild
    return json.access_token;
}

// Function to put a user in the guild after they have been accepted
async function putUserInGuild(access_token, user_id, guild_id, roles) {
    let userMC = await getUserMC(user_id);

    // Make request to discord
    await fetch(`https://discord.com/api/v10/guilds/${guild_id}/members/${user_id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${process.env.BOT_TOKEN}`
        },
        body: JSON.stringify({
            // Access token is required to put the user in the guild
            access_token: access_token,
            nick: userMC,
            roles: roles,
        })
    }).catch(err => {
        // If there is an error, log it and stop the request
        console.log(err);
        return false;
    });

    // Probably successful as we didn't catch any errors
    // Return ok
    return true;
}

// Export all functions so they can be used in other files
module.exports = { checkUserPermissions, getUserMC, getUserBanStatus, refreshAccessToken, putUserInGuild };