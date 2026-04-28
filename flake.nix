{
  description = "Madame — minimal two-pane Markdown editor";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "x86_64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = import ./nix/devshell.nix { inherit pkgs; };
        packages.default  = import ./nix/package.nix  { inherit pkgs; };
        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/madame";
        };
      }
    );
}
