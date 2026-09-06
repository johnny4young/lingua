class LinguaCli < Formula
  desc "Headless offline CLI for Lingua utilities, runners, and Run Capsules"
  homepage "https://linguacode.dev/cli"
  url "https://github.com/johnny4young/lingua/releases/download/v1.4.1/linguacode-cli-1.4.1.tgz"
  sha256 "47cf66cce9ebdd9202f12f7f24cb3b3c2206da5c15e62e3c1f2c213c393558ed"
  license :cannot_represent

  depends_on "node@24"

  def install
    package_root = (buildpath/"package").directory? ? buildpath/"package" : buildpath
    libexec.install package_root/"LICENSE", package_root/"README.md", package_root/"package.json"
    (libexec/"bin").install package_root/"bin/lingua.cjs"
    (bin/"lingua").write_env_script libexec/"bin/lingua.cjs", PATH: "#{formula_opt_bin("node@24")}:$PATH"
    generate_completions_from_executable(bin/"lingua", "completion")
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/lingua --version").strip
    assert_equal "aGVsbG8=", pipe_output("#{bin}/lingua utility base64-encode", "hello").strip
    assert_path_exists bash_completion/"lingua"
    assert_path_exists zsh_completion/"_lingua"
    assert_path_exists fish_completion/"lingua.fish"
  end
end
