# Fish completions for npg

# Disable file completions by default
complete -c npg -f

# Commands
complete -c npg -n __fish_use_subcommand -a install -d "Install packages globally"
complete -c npg -n __fish_use_subcommand -a add -d "Install packages globally"
complete -c npg -n __fish_use_subcommand -a i -d "Install packages globally"
complete -c npg -n __fish_use_subcommand -a uninstall -d "Uninstall packages"
complete -c npg -n __fish_use_subcommand -a remove -d "Uninstall packages"
complete -c npg -n __fish_use_subcommand -a rm -d "Uninstall packages"
complete -c npg -n __fish_use_subcommand -a ls -d "List installed packages"
complete -c npg -n __fish_use_subcommand -a list -d "List installed packages"
complete -c npg -n __fish_use_subcommand -a outdated -d "Show outdated packages"
complete -c npg -n __fish_use_subcommand -a update -d "Update packages"
complete -c npg -n __fish_use_subcommand -a up -d "Update packages"
complete -c npg -n __fish_use_subcommand -a completion -d "Output fish completions"

# Suggest installed packages for uninstall/remove/rm/update/up/outdated
function __npg_installed_packages
  set -l npg_home (set -q NPG_HOME; and echo $NPG_HOME; or echo ~/.local/npg)
  set -l pkg_json "$npg_home/package.json"
  if test -f "$pkg_json"
    node -e "
      const deps = JSON.parse(require('fs').readFileSync('$pkg_json','utf-8')).dependencies ?? {};
      for (const name of Object.keys(deps)) console.log(name);
    " 2>/dev/null
  end
end

complete -c npg -n "__fish_seen_subcommand_from uninstall remove rm update up outdated" -a "(__npg_installed_packages)" -f

# Allow path completion for local package specs on install/add/i
complete -c npg -n "__fish_seen_subcommand_from install add i" -F
