function getAvailableForms(permissionsMap = {}) {
    let forms = [];

    let eventOneApplication = {
        name: "Event One Application",
        id: "eventOneApplication",
        description: "Apply to be a part of the first event!",
        permissionNeeded: "user"
    }

    // check if user has permission from PermissionsMap if so, push
    if (permissionsMap.user) {
        forms.push(eventOneApplication);
    }

    return forms;
}

module.exports = { getAvailableForms };