// Require express as a base
const Route = require('express').Router;

// Setup custom router class
class Router {
    // Constructor for each route instance
    constructor(client, path, auth = false) {
        this.client = client;
        this.path = path;
        this.auth = auth;
        this.router = Route();
    }

    // Method to create a route
    // Return the express router back to express so it can register it
    createRoute() {
        return this.router;
    }
};

module.exports = Router;
