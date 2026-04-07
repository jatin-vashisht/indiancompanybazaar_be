// swagger.js
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Kahem India API",
      version: "1.0.0",
      description: "API documentation for Kahem India — India's Trusted Business Marketplace",
    },
    servers: [
      {
        url: "https://api.kahemindia.com",
        description: "Production",
      },
      {
        url: "http://localhost:5000",
        description: "Local",
      },
    ],

    // 👇 The critical part you were missing
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your JWT token in the format: **Bearer <your-token>**",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },

  apis: ["./routes/*.js"], // 👈 Make sure your routes contain the @swagger docs
};

const swaggerSpec = swaggerJsDoc(options);

function swaggerDocs(app) {
  // Serve Swagger UI
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Optional: serve raw JSON
  app.get("/swagger.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

module.exports = swaggerDocs;
