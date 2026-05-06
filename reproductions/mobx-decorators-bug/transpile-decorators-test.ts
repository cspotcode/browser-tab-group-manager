function decorator(_target: any, _context: any) {}

class Foo {
    @decorator accessor foo = 1;
}
class Bar {
    @decorator accessor bar = 1;
}

function detectDecoratorType(...args: any[]) {
  const isStandard = args.length === 2 && typeof args[1] === 'object' && 'kind' in args[1];
  const isLegacy = args.length === 3 || (args.length === 1 && typeof args[0] === 'function');

  if (isStandard) {
    console.log("✅ Using ES Standard Decorators (Stage 3)");
  } else if (isLegacy) {
    console.log("⚠️ Using Legacy Experimental Decorators");
  } else {
    console.log("❓ Unknown decorator format", args.length, args);
  }
}

@detectDecoratorType
class TestDetection {
  @detectDecoratorType
  testMethod() {}
}