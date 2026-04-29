const { runGameLogicTests } = require('./gameLogic.test');

function run() {
  try {
    runGameLogicTests();
    // eslint-disable-next-line no-console
    console.log('Todos os testes passaram.');
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Falha nos testes:', error.message);
    process.exit(1);
  }
}

run();
