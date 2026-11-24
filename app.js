const express = require("express");
const routes = require("./routes");
const cors = require('cors');
require('dotenv').config();

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: '*'
}))
app.use("/", routes);

// Consistent JSON response for malformed JSON and unexpected errors.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request"
    });
  }

  console.error("[API ERROR]", err);
  return res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// Vercel imports this Express app as its serverless function.
// This also allows local execution with: npm start
if (require.main === module) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => {
    console.log(`PRA/FBR Simulator running at http://localhost:${port}`);
  });
}

module.exports = app;
