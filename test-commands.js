const fs = require('fs');
const path = require('path');
const { ApplicationCommandOptionType } = require('discord.js');

const commandsPath = path.join(__dirname, 'src', 'commands');
const categories = fs.readdirSync(commandsPath).filter(f => fs.statSync(path.join(commandsPath, f)).isDirectory());

// Single source of truth: the set the bot actually registers with (a stale copy here drifted before).
const { PREFIX_ONLY } = require('./src/handlers/commandHandler');

let pass = 0;
let fail = 0;
let warns = 0;
const errors = [];
const warnings = [];
const names = new Map();

for (const cat of categories) {
  const files = fs.readdirSync(path.join(commandsPath, cat)).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const loc = `${cat}/${file}`;
    try {
      delete require.cache[require.resolve(path.join(commandsPath, cat, file))];
      const cmd = require(path.join(commandsPath, cat, file));

      // 1. Has data + execute
      if (!cmd.data) { errors.push(`${loc}: missing data export`); fail++; continue; }
      if (!cmd.execute) { errors.push(`${loc}: missing execute export`); fail++; continue; }
      if (typeof cmd.execute !== 'function') { errors.push(`${loc}: execute is not a function`); fail++; continue; }

      // 2. Serializes without error
      const json = cmd.data.toJSON();

      // 3. Name validation
      if (!json.name) { errors.push(`${loc}: empty command name`); fail++; continue; }
      if (json.name.length > 32) { errors.push(`${loc}: name too long (${json.name.length})`); fail++; continue; }
      if (!/^[\w-]{1,32}$/.test(json.name)) { errors.push(`${loc}: invalid name chars: ${json.name}`); fail++; continue; }

      // 4. Duplicate check
      if (names.has(json.name)) {
        errors.push(`${loc}: DUPLICATE name "${json.name}" (also in ${names.get(json.name)})`);
        fail++; continue;
      }
      names.set(json.name, loc);

      // 5. Description validation
      if (!json.description) { errors.push(`${loc}: missing description`); fail++; continue; }
      if (json.description.length > 100) { errors.push(`${loc}: description too long (${json.description.length})`); fail++; continue; }

      // 6. Options validation
      if (json.options) {
        if (json.options.length > 25) { errors.push(`${loc}: too many options (${json.options.length})`); fail++; continue; }

        for (const opt of json.options) {
          if (opt.name && opt.name.length > 32) {
            errors.push(`${loc}: option "${opt.name}" name too long`); fail++; continue;
          }
          if (opt.description && opt.description.length > 100) {
            errors.push(`${loc}: option "${opt.name}" description too long (${opt.description.length})`);
            fail++; continue;
          }

          // Subcommand options
          if (opt.type === ApplicationCommandOptionType.Subcommand && opt.options) {
            if (opt.options.length > 25) {
              errors.push(`${loc}: subcommand "${opt.name}" too many options (${opt.options.length})`);
              fail++; continue;
            }
            for (const sub of opt.options) {
              if (sub.description && sub.description.length > 100) {
                errors.push(`${loc}: "${opt.name}.${sub.name}" description too long (${sub.description.length})`);
                fail++; continue;
              }
            }
          }
        }

        // Subcommand consistency: if one option is a subcommand, all must be
        const hasSubcommands = json.options.some(o => o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup);
        const hasNonSubcommands = json.options.some(o => o.type !== ApplicationCommandOptionType.Subcommand && o.type !== ApplicationCommandOptionType.SubcommandGroup);
        if (hasSubcommands && hasNonSubcommands) {
          errors.push(`${loc}: mixes subcommands with regular options`);
          fail++; continue;
        }
      }

      // 7. PREFIX_ONLY consistency
      const isPrefix = PREFIX_ONLY.has(json.name);
      const tag = isPrefix ? 'prefix' : 'slash';

      // 8. Execute function arity check
      if (cmd.execute.length === 0) {
        warnings.push(`${loc}: execute() takes 0 params (expected interaction)`);
        warns++;
      }

      pass++;
    } catch (e) {
      errors.push(`${loc}: ${e.message.split('\n')[0]}`);
      fail++;
    }
  }
}

// Summary
const slashCount = [...names.values()].filter((_, i) => !PREFIX_ONLY.has([...names.keys()][i])).length;
const prefixCount = [...names.keys()].filter(n => PREFIX_ONLY.has(n)).length;

console.log('\n=== SONDER COMMAND TEST ===\n');
console.log(`Total: ${pass + fail} commands`);
console.log(`  Pass: ${pass}`);
console.log(`  Fail: ${fail}`);
console.log(`  Warnings: ${warns}`);
console.log(`\nSlash: ${names.size - prefixCount} (limit 100)`);
console.log(`Prefix-only: ${prefixCount}`);

if (errors.length) {
  console.log('\n--- ERRORS ---');
  errors.forEach(e => console.log(`  FAIL  ${e}`));
}

if (warnings.length) {
  console.log('\n--- WARNINGS ---');
  warnings.forEach(w => console.log(`  WARN  ${w}`));
}

if (!errors.length && !warnings.length) {
  console.log('\nAll commands valid.');
}

process.exit(fail > 0 ? 1 : 0);
