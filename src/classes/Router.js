const Route = require('express').Router;
class Router {
    constructor(client, path, auth = false) {
        this.client = client;
        this.path = path;
        this.auth = auth;
        this.router = Route();
    }
    createRoute() {
        return this.router;
    }
}
module.exports = Router;
