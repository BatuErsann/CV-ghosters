const { server } = require("../server");

module.exports = (request, response) => server.emit("request", request, response);
