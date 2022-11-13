const Router = require('../classes/Router');

class API extends Router {
    constructor(client) {
        super(client, '/api');
    }
    createRoute() {

        this.router.get('/', async (req, res) => {
            try {
                let packageConf = require('../../package.json')
                res.json({
                    "message": "Welcome to the Protagnst-Secure API",
                    "version": packageConf.version
                });

            } catch (e) {
                console.log(e)
            }
        });

        this.router.use((req, res) => {
            res.status(404).json({
                "error": "This API endpoint is invalid or has moved."
            });
        });

        return this.router
    }
}

module.exports = API;