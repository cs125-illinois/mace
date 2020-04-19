import typescript from "rollup-plugin-typescript2"
import resolve from "rollup-plugin-node-resolve"
import commonJS from "rollup-plugin-commonjs"

export default {
  input: "./client/index.tsx",
  output: {
    format: "cjs",
    file: "./client/dist/index.cjs.js",
    sourcemap: true,
  },
  plugins: [
    typescript({
      tsconfigDefaults: {
        include: ["./client/**/*"],
        compilerOptions: { declaration: true },
      },
    }),
    resolve({ preferBuiltins: true }),
    commonJS({
      include: "node_modules/**",
      namedExports: {
        runtypes: ["Record", "Partial", "Number", "String", "Array", "Static", "Union"],
      },
    }),
  ],
  external: ["react", "prop-types", "react-ace", "crypto"],
  onwarn: (warning, next) => {
    if (warning.code === "CIRCULAR_DEPENDENCY") return
    if (warning.code === "EVAL") return
    next(warning)
  },
}
