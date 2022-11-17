const { executeMysqlQuery } = require("./mysqlHelper");

async function getAvailableForms(req) {
    if (!req.session.discordId) return false;

    let formsArray = await executeMysqlQuery(`SELECT * FROM forms`);

    let user = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [req.session.discordId]);
    let userPermission = user[0].permission_level;

    for (let i = 0; i < formsArray.length; i++) {
        if (formsArray[i].permissions_needed > userPermission) {
            formsArray.splice(i, 1);
            i--;
        }
    };

    let submittedForms = await executeMysqlQuery(`SELECT form_id FROM submissions WHERE discord_id = ?`, [req.session.discordId]);
    submittedForms.forEach(element => {
        formsArray = formsArray.filter(form => form.id !== element.form_id);
    });

    if (formsArray.length > 0) return formsArray;
    return false;

    // permissions: user, staff, site_admin
}

module.exports = { getAvailableForms };