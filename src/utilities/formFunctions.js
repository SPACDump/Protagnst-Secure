const { executeMysqlQuery } = require("./mysqlHelper");

async function getAvailableForms(req) {
    if (!req.session.discordId) return false;

    let formsArray = await executeMysqlQuery(`SELECT * FROM forms`);
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.session.discordId]);

    let userPermission = user[0].perms;

    for (let i = 0; i < formsArray.length; i++) {
        if (formsArray[i].permissions_needed > userPermission) {
            formsArray.splice(i, 1);
            i--;
        }
    };

    // get user id
    let userID = user[0].id;

    let submittedForms = await executeMysqlQuery(`SELECT form_id FROM submissions WHERE user_id = ?`, [userID]);
    submittedForms.forEach(element => {
        formsArray = formsArray.filter(form => form.id !== element.form_id);
    });

    formsArray = formsArray.filter(form => form.is_hidden != 1);

    if (formsArray.length > 0) return formsArray;
    return false;
}

async function getOpenForms(req) {
    let formsArray = await executeMysqlQuery(`SELECT * FROM forms`);
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.session.discordId]);

    let userPermission = user[0].perms;

    for (let i = 0; i < formsArray.length; i++) {
        if (formsArray[i].permissions_needed > userPermission) {
            formsArray.splice(i, 1);
            i--;
        }
    }

    formsArray = formsArray.filter(form => form.is_hidden != 1);

    if (formsArray.length > 0) return formsArray;
    return false;
}

async function getPreviousSubmissions(req) {
    if (!req.session.discordId) return false;

    // get user id
    let user = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.session.discordId]);
    if (!user) return false;
    let userID = user[0].id;

    let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE user_id = ?`, [userID]);

    // getAvailbleForms and if any have is_hidden set to 1, remove from this array
    let formsArray = await executeMysqlQuery(`SELECT * FROM forms`);
    
    if (formsArray) {
        formsArray.forEach(form => {
            if (form.is_hidden) {
                submissions = submissions.filter(submission => submission.form_id !== form.id);
            }
        });
    } else { 
        return false;
    }

    if (submissions.length > 0) return submissions;
    return false;
}

async function getFormById(formId) {
    let form = await executeMysqlQuery(`SELECT * FROM forms WHERE id = ?`, [formId]);
    return form[0];
}

module.exports = { getAvailableForms, getFormById, getPreviousSubmissions, getOpenForms };