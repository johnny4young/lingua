cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "2.3.0"
  sha256 arm:   "8fc8c03fd22f0fe4399f2efd6dde75e76615b242fb731462da4ca48bda67afa1",
         intel: "ce7e01dfa7ef88cbbc89265cc09cbc4ce4fdd87e5991e79f24de36540dd0af80"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :ventura

  app "lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
