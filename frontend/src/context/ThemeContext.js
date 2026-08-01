import React, { createContext, useState, useMemo, useContext } from 'react';
import { createTheme, ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });

  const toggleTheme = () => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
    localStorage.setItem('theme', newMode);
  };

  const theme = useMemo(
    () => {
      const glassPaper = mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(24,26,32,0.66)';
      const glassBorder = mode === 'light' ? '1px solid rgba(255,255,255,0.6)' : '1px solid rgba(255,255,255,0.08)';
      const blur = 'blur(20px) saturate(180%)';

      return createTheme({
        palette: {
          mode,
          primary: {
            // Wallet-style green brand palette.
            main: mode === 'light' ? '#1aa565' : '#34c77b',
            light: mode === 'light' ? '#4cc088' : '#66d69b',
            dark: mode === 'light' ? '#127a49' : '#1aa565',
            contrastText: '#ffffff',
          },
          secondary: {
            main: mode === 'light' ? '#0f6e46' : '#7fd7ad',
          },
          success: {
            main: mode === 'light' ? '#2e7d32' : '#66bb6a',
          },
          error: {
            main: mode === 'light' ? '#d32f2f' : '#f44336',
          },
          warning: {
            main: mode === 'light' ? '#ed6c02' : '#ffa726',
          },
          background: {
            default: mode === 'light' ? '#eef3f0' : '#0b0d10',
            paper: glassPaper,
          },
        },
        typography: {
          fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
          h4: {
            fontWeight: 700,
            letterSpacing: -0.3,
          },
          h5: {
            fontWeight: 700,
            letterSpacing: -0.2,
          },
          h6: {
            fontWeight: 600,
          },
        },
        shape: {
          borderRadius: 16,
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                minHeight: '100vh',
                backgroundColor: mode === 'light' ? '#eef3f0' : '#0b0d10',
                backgroundImage: mode === 'light'
                  ? 'radial-gradient(1200px circle at 10% -10%, rgba(26,165,101,0.12), transparent 45%), ' +
                    'radial-gradient(1000px circle at 110% 10%, rgba(63,120,222,0.09), transparent 40%), ' +
                    'radial-gradient(900px circle at 40% 120%, rgba(214,102,196,0.07), transparent 45%)'
                  : 'radial-gradient(1200px circle at 10% -10%, rgba(52,199,123,0.16), transparent 45%), ' +
                    'radial-gradient(1000px circle at 110% 10%, rgba(90,140,255,0.11), transparent 40%), ' +
                    'radial-gradient(900px circle at 40% 120%, rgba(214,102,196,0.09), transparent 45%)',
                backgroundAttachment: 'fixed',
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
                backdropFilter: blur,
                WebkitBackdropFilter: blur,
                border: glassBorder,
              },
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                boxShadow: mode === 'light'
                  ? '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)'
                  : '0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)',
                transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                '&:hover': {
                  transform: 'translateY(-3px)',
                  boxShadow: mode === 'light'
                    ? '0 4px 12px rgba(16,24,40,0.08), 0 16px 32px rgba(16,24,40,0.10)'
                    : '0 4px 12px rgba(0,0,0,0.4), 0 16px 32px rgba(0,0,0,0.5)',
                },
              },
            },
          },
          MuiAppBar: {
            // AppBar's built-in `colorPrimary`/`colorTransparent` style rules are
            // generated after `root` in the stylesheet, so a background-color set
            // only on `root` gets silently overridden by whichever color variant is
            // active. Setting the default color to 'transparent' and putting the
            // actual glass background on `colorTransparent` avoids that.
            defaultProps: {
              color: 'transparent',
            },
            styleOverrides: {
              root: {
                backdropFilter: blur,
                WebkitBackdropFilter: blur,
                color: mode === 'light' ? '#14251d' : '#e8f5ee',
                boxShadow: 'none',
                borderBottom: mode === 'light' ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.06)',
              },
              colorTransparent: {
                backgroundColor: mode === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(18,20,25,0.65)',
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 10,
              },
              contained: {
                boxShadow: mode === 'light'
                  ? '0 4px 14px rgba(26,165,101,0.25)'
                  : '0 4px 14px rgba(52,199,123,0.25)',
                '&:hover': {
                  boxShadow: mode === 'light'
                    ? '0 6px 20px rgba(26,165,101,0.35)'
                    : '0 6px 20px rgba(52,199,123,0.35)',
                },
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                fontWeight: 500,
              },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                borderRadius: 10,
                backgroundColor: mode === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.03)',
              },
            },
          },
          MuiListItemButton: {
            styleOverrides: {
              root: {
                borderRadius: 10,
                '&.Mui-selected': {
                  background: mode === 'light'
                    ? 'linear-gradient(135deg, rgba(26,165,101,0.16), rgba(26,165,101,0.04))'
                    : 'linear-gradient(135deg, rgba(52,199,123,0.22), rgba(52,199,123,0.06))',
                  '&:hover': {
                    background: mode === 'light'
                      ? 'linear-gradient(135deg, rgba(26,165,101,0.22), rgba(26,165,101,0.07))'
                      : 'linear-gradient(135deg, rgba(52,199,123,0.28), rgba(52,199,123,0.10))',
                  },
                },
              },
            },
          },
          MuiDivider: {
            styleOverrides: {
              root: {
                borderColor: mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
              },
            },
          },
        },
      });
    },
    [mode]
  );

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
