// SPDX-License-Identifier: MIT
/** Deterministic, network-free shell completion generators. */

import { UTILITY_ADAPTER_IDS } from '../shared/utilities/types';
import {
  CLI_COLOR_MODES,
  CLI_COMPLETION_SHELLS,
  CLI_TOP_LEVEL_COMMANDS,
  type CliCompletionShell,
} from './commandModel';

const commandWords = CLI_TOP_LEVEL_COMMANDS.join(' ');
const colorWords = CLI_COLOR_MODES.join(' ');
const shellWords = CLI_COMPLETION_SHELLS.join(' ');
const utilityWords = [...UTILITY_ADAPTER_IDS].sort().join(' ');

export function renderCompletion(shell: CliCompletionShell): string {
  switch (shell) {
    case 'bash':
      return renderBashCompletion();
    case 'zsh':
      return renderZshCompletion();
    case 'fish':
      return renderFishCompletion();
  }
}

function renderBashCompletion(): string {
  return `# lingua bash completion
_lingua() {
  local cur prev command command_index index relative word
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev=""
  if (( COMP_CWORD > 0 )); then
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  fi
  command=""
  command_index=0
  for (( index=1; index<COMP_CWORD; index++ )); do
    word="\${COMP_WORDS[index]}"
    case "$word" in
      --color)
        (( index++ ))
        ;;
      --color=*)
        ;;
      utility|run|capsule|list|completion)
        command="$word"
        command_index=$index
        break
        ;;
    esac
  done

  case "$cur" in
    --color=*)
      local value="\${cur#--color=}"
      COMPREPLY=( $(compgen -W "${colorWords}" -- "$value") )
      COMPREPLY=( "\${COMPREPLY[@]/#/--color=}" )
      return
      ;;
  esac

  case "$prev" in
    --color)
      COMPREPLY=( $(compgen -W "${colorWords}" -- "$cur") )
      return
      ;;
    --input|--stdin)
      compopt -o filenames 2>/dev/null || true
      COMPREPLY=( $(compgen -f -- "$cur") )
      return
      ;;
    --timeout)
      return
      ;;
    --env|--option)
      return
      ;;
  esac

  if [[ -z "$command" ]]; then
    COMPREPLY=( $(compgen -W "${commandWords} --help --version --color" -- "$cur") )
    return
  fi

  case "$command" in
    utility)
      relative=$(( COMP_CWORD - command_index ))
      if (( relative == 1 )); then
        COMPREPLY=( $(compgen -W "${utilityWords}" -- "$cur") )
      elif [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--input --option --json --quiet --color --help" -- "$cur") )
      fi
      ;;
    run)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--stdin --timeout --env --json --quiet --color --help --" -- "$cur") )
      else
        compopt -o filenames 2>/dev/null || true
        COMPREPLY=( $(compgen -f -- "$cur") )
      fi
      ;;
    capsule)
      relative=$(( COMP_CWORD - command_index ))
      if (( relative == 1 )); then
        COMPREPLY=( $(compgen -W "validate replay" -- "$cur") )
      elif [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--timeout --env --json --quiet --color --help" -- "$cur") )
      else
        compopt -o filenames 2>/dev/null || true
        COMPREPLY=( $(compgen -f -- "$cur") )
      fi
      ;;
    list)
      relative=$(( COMP_CWORD - command_index ))
      if (( relative == 1 )); then
        COMPREPLY=( $(compgen -W "utilities" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "--json --quiet --color --help" -- "$cur") )
      fi
      ;;
    completion)
      relative=$(( COMP_CWORD - command_index ))
      if (( relative == 1 )); then
        COMPREPLY=( $(compgen -W "${shellWords}" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "--color --help" -- "$cur") )
      fi
      ;;
  esac
}
complete -F _lingua lingua
`;
}

function renderZshCompletion(): string {
  return `#compdef lingua
# lingua zsh completion
_lingua() {
  local context state state_descr line
  typeset -A opt_args
  local -a commands utilities color_modes shells
  local command_index index
  commands=(
    'utility:Run a shared utility adapter'
    'run:Execute a source file or project root'
    'capsule:Validate or replay a Run Capsule'
    'list:List available capabilities'
    'completion:Generate a shell completion script'
  )
  utilities=(${utilityWords})
  color_modes=(${colorWords})
  shells=(${shellWords})

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Print the CLI version]' \\
    '--color=[Control diagnostic color]:mode:(auto always never)' \\
    '1:command:->command' \\
    '*::argument:->arguments'

  case "$state" in
    command)
      _describe -t commands 'lingua command' commands
      ;;
    arguments)
      command_index=0
      for (( index=2; index<CURRENT; index++ )); do
        case "\${words[index]}" in
          --color)
            (( index++ ))
            ;;
          --color=*)
            ;;
          utility|run|capsule|list|completion)
            command_index=$index
            break
          ;;
        esac
      done
      if (( command_index == 0 )); then
        return 0
      fi
      words=("\${(@)words[$command_index,-1]}")
      (( CURRENT -= command_index - 1 ))
      case "\${words[1]}" in
        utility)
          if (( CURRENT == 2 )); then
            _describe -t utilities 'utility' utilities
          else
            _arguments \\
              '--input=[Read input from a file]:file:_files' \\
              '*--option=[Pass an adapter key=value option]:option:' \\
              '--json[Emit structured JSON]' \\
              '--quiet[Suppress Lingua diagnostics]' \\
              '--color=[Control diagnostic color]:mode:(auto always never)' \\
              '(-h --help)'{-h,--help}'[Show help]'
          fi
          ;;
        run)
          _arguments \\
            '1:source file or project:_files' \\
            '--stdin=[Forward a file as program stdin]:file:_files' \\
            '--timeout=[Set wall-clock timeout in milliseconds]:milliseconds:' \\
            '*--env=[Add an explicit NAME=value environment entry]:environment:' \\
            '--json[Emit structured JSON]' \\
            '--quiet[Suppress Lingua diagnostics]' \\
            '--color=[Control diagnostic color]:mode:(auto always never)' \\
            '(-h --help)'{-h,--help}'[Show help]' \\
            '*::program argument:'
          ;;
        capsule)
          if (( CURRENT == 2 )); then
            _values 'capsule action' validate replay
          else
            _arguments \\
              '2:capsule file:_files' \\
              '--timeout=[Set replay timeout in milliseconds]:milliseconds:' \\
              '*--env=[Add an explicit NAME=value environment entry]:environment:' \\
              '--json[Emit structured JSON]' \\
              '--quiet[Suppress Lingua diagnostics]' \\
              '--color=[Control diagnostic color]:mode:(auto always never)' \\
              '(-h --help)'{-h,--help}'[Show help]'
          fi
          ;;
        list)
          _values 'list target' utilities
          ;;
        completion)
          _describe -t shells 'shell' shells
          ;;
      esac
      ;;
  esac
}
if (( $+functions[compdef] )); then
  compdef _lingua lingua
fi
`;
}

function renderFishCompletion(): string {
  const utilityLines = [...UTILITY_ADAPTER_IDS]
    .sort()
    .map(id => `complete -c lingua -n '__fish_lingua_needs_first_argument utility' -a '${id}'`)
    .join('\n');
  return `# lingua fish completion
function __fish_lingua_needs_command
    set -l command_index (__fish_lingua_command_index)
    test -z "$command_index"
end

function __fish_lingua_command_index
    set -l tokens (commandline -opc)
    set -l skip_next 0
    for index in (seq 2 (count $tokens))
        set -l token $tokens[$index]
        if test $skip_next -eq 1
            set skip_next 0
            continue
        end
        switch $token
            case --color
                set skip_next 1
            case '--color=*' --json --quiet --help -h --version -v
                continue
            case utility run capsule list completion
                echo $index
                return 0
        end
    end
    return 1
end

function __fish_lingua_using_command
    set -l tokens (commandline -opc)
    set -l command_index (__fish_lingua_command_index)
    test -n "$command_index"; and test "$tokens[$command_index]" = "$argv[1]"
end

function __fish_lingua_needs_first_argument
    set -l tokens (commandline -opc)
    set -l command_index (__fish_lingua_command_index)
    if test -z "$command_index"; or test "$tokens[$command_index]" != "$argv[1]"
        return 1
    end
    set -l skip_next 0
    for index in (seq (math $command_index + 1) (count $tokens))
        set -l token $tokens[$index]
        if test $skip_next -eq 1
            set skip_next 0
            continue
        end
        switch $token
            case --color --input --option --stdin --timeout --env
                set skip_next 1
            case '--color=*' '--input=*' '--option=*' '--stdin=*' '--timeout=*' '--env=*' --json --quiet --help -h
                continue
            case '*'
                return 1
        end
    end
    return 0
end

complete -c lingua -f -n __fish_lingua_needs_command -a 'utility' -d 'Run a shared utility adapter'
complete -c lingua -f -n __fish_lingua_needs_command -a 'run' -d 'Execute a source file or project root'
complete -c lingua -f -n __fish_lingua_needs_command -a 'capsule' -d 'Validate or replay a Run Capsule'
complete -c lingua -f -n __fish_lingua_needs_command -a 'list' -d 'List available capabilities'
complete -c lingua -f -n __fish_lingua_needs_command -a 'completion' -d 'Generate a shell completion script'

complete -c lingua -l help -s h -d 'Show help'
complete -c lingua -l version -s v -d 'Print the CLI version'
complete -c lingua -l color -r -f -a '${colorWords}' -d 'Control diagnostic color'
complete -c lingua -l json -d 'Emit structured JSON'
complete -c lingua -l quiet -d 'Suppress Lingua diagnostics'

${utilityLines}
complete -c lingua -n '__fish_lingua_using_command utility' -l input -r -F -d 'Read input from a file'
complete -c lingua -n '__fish_lingua_using_command utility' -l option -r -d 'Pass an adapter key=value option'

complete -c lingua -n '__fish_lingua_using_command run' -l stdin -r -F -d 'Forward a file as program stdin'
complete -c lingua -n '__fish_lingua_using_command run' -l timeout -r -d 'Set wall-clock timeout in milliseconds'
complete -c lingua -n '__fish_lingua_using_command run' -l env -r -d 'Add an explicit NAME=value environment entry'

complete -c lingua -n '__fish_lingua_needs_first_argument capsule' -a 'validate replay'
complete -c lingua -n '__fish_lingua_using_command capsule' -l timeout -r -d 'Set replay timeout in milliseconds'
complete -c lingua -n '__fish_lingua_using_command capsule' -l env -r -d 'Add an explicit NAME=value environment entry'

complete -c lingua -n '__fish_lingua_needs_first_argument list' -a 'utilities'
complete -c lingua -n '__fish_lingua_needs_first_argument completion' -a '${shellWords}'
`;
}
